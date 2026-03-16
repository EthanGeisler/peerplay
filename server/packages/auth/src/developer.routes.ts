import { Router } from "express";
import crypto from "crypto";
import { z, ZodError } from "zod";
import { db, redis, authenticate, requireRole, getStripe, ValidationError, ConflictError, NotFoundError, getConfig } from "@boilerdeck/shared";

export const developerRouter = Router();

/** Generate a short-lived token for Stripe Connect return/refresh URLs */
async function createOnboardToken(developerId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await redis.set(`stripe_onboard:${token}`, developerId, "EX", 3600); // 1 hour TTL
  return token;
}

/** Verify and consume a Stripe Connect onboard token, returns developerId or null */
async function verifyOnboardToken(token: string): Promise<string | null> {
  const developerId = await redis.get(`stripe_onboard:${token}`);
  if (developerId) {
    await redis.del(`stripe_onboard:${token}`);
  }
  return developerId;
}

const registerDevSchema = z.object({
  studioName: z.string().min(2).max(100),
});

// Register as a developer
developerRouter.post("/developer/register", authenticate, async (req, res, next) => {
  try {
    let input;
    try {
      input = registerDevSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ValidationError(err.errors.map((e) => e.message).join(", "));
      }
      throw err;
    }

    const userId = req.user!.sub;

    const existing = await db.developer.findUnique({ where: { userId } });
    if (existing) {
      throw new ConflictError("Already registered as a developer");
    }

    const developer = await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { role: "DEVELOPER" },
      });

      return tx.developer.create({
        data: {
          userId,
          studioName: input.studioName,
        },
      });
    });

    res.status(201).json({
      id: developer.id,
      studioName: developer.studioName,
      stripeOnboarded: developer.stripeOnboarded,
    });
  } catch (err) {
    next(err);
  }
});

// Get Stripe Connect onboarding URL
developerRouter.get(
  "/developer/stripe/onboard",
  authenticate,
  requireRole("DEVELOPER"),
  async (req, res, next) => {
    try {
      const developer = await db.developer.findUnique({
        where: { userId: req.user!.sub },
      });

      if (!developer) {
        throw new NotFoundError("Developer profile");
      }

      if (developer.stripeOnboarded) {
        res.json({ status: "already_onboarded" });
        return;
      }

      const stripe = getStripe();
      const config = getConfig();

      // Create a Connect Express account if developer doesn't have one yet
      let stripeAccountId = developer.stripeAccountId;
      if (!stripeAccountId) {
        const account = await stripe.accounts.create({
          type: "express",
          metadata: { developerId: developer.id },
        });
        stripeAccountId = account.id;

        await db.developer.update({
          where: { id: developer.id },
          data: { stripeAccountId },
        });
      }

      // Create a signed token for the return/refresh URLs
      const onboardToken = await createOnboardToken(developer.id);

      const returnUrl = config.STRIPE_CONNECT_RETURN_URL
        || `${config.CORS_ORIGIN}/api/developer/stripe/onboard/return`;
      const refreshUrl = config.STRIPE_CONNECT_REFRESH_URL
        || `${config.CORS_ORIGIN}/api/developer/stripe/onboard/refresh`;

      const accountLink = await stripe.accountLinks.create({
        account: stripeAccountId,
        return_url: `${returnUrl}?token=${onboardToken}`,
        refresh_url: `${refreshUrl}?token=${onboardToken}`,
        type: "account_onboarding",
      });

      res.json({ url: accountLink.url });
    } catch (err) {
      next(err);
    }
  },
);

// Stripe Connect onboarding return — check status and redirect to dev portal
// No auth middleware — Stripe redirects the browser here with a signed token
developerRouter.get(
  "/developer/stripe/onboard/return",
  async (req, res, next) => {
    try {
      const token = String(req.query.token || "");
      const developerId = token ? await verifyOnboardToken(token) : null;

      if (developerId) {
        const developer = await db.developer.findUnique({
          where: { id: developerId },
        });

        if (developer?.stripeAccountId) {
          const stripe = getStripe();
          const account = await stripe.accounts.retrieve(developer.stripeAccountId);

          await db.developer.update({
            where: { id: developer.id },
            data: {
              stripeOnboarded: account.charges_enabled ?? false,
              stripePayoutsEnabled: account.payouts_enabled ?? false,
            },
          });
        }
      }

      // Redirect to dev portal dashboard
      res.redirect(`${getConfig().CORS_ORIGIN}/dev/#/`);
    } catch (err) {
      next(err);
    }
  },
);

// Stripe Connect onboarding refresh — generate new link (previous one expired)
// No auth middleware — Stripe redirects the browser here with a signed token
developerRouter.get(
  "/developer/stripe/onboard/refresh",
  async (req, res, next) => {
    try {
      const token = String(req.query.token || "");
      const developerId = token ? await verifyOnboardToken(token) : null;

      if (!developerId) {
        throw new ValidationError("Invalid or expired onboarding link");
      }

      const developer = await db.developer.findUnique({
        where: { id: developerId },
      });

      if (!developer || !developer.stripeAccountId) {
        throw new NotFoundError("Developer profile");
      }

      const stripe = getStripe();
      const config = getConfig();

      // Generate a fresh token for the new URLs
      const newToken = await createOnboardToken(developer.id);

      const returnUrl = config.STRIPE_CONNECT_RETURN_URL
        || `${config.CORS_ORIGIN}/api/developer/stripe/onboard/return`;
      const refreshUrl = config.STRIPE_CONNECT_REFRESH_URL
        || `${config.CORS_ORIGIN}/api/developer/stripe/onboard/refresh`;

      const accountLink = await stripe.accountLinks.create({
        account: developer.stripeAccountId,
        return_url: `${returnUrl}?token=${newToken}`,
        refresh_url: `${refreshUrl}?token=${newToken}`,
        type: "account_onboarding",
      });

      res.redirect(accountLink.url);
    } catch (err) {
      next(err);
    }
  },
);

// Get developer profile
developerRouter.get(
  "/developer/profile",
  authenticate,
  requireRole("DEVELOPER"),
  async (req, res, next) => {
    try {
      const developer = await db.developer.findUnique({
        where: { userId: req.user!.sub },
        include: {
          games: {
            select: {
              id: true,
              slug: true,
              title: true,
              status: true,
              priceCents: true,
              createdAt: true,
            },
          },
        },
      });

      if (!developer) {
        throw new NotFoundError("Developer profile");
      }

      res.json(developer);
    } catch (err) {
      next(err);
    }
  },
);
