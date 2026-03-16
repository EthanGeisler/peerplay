import { Router } from "express";
import { z, ZodError } from "zod";
import Stripe from "stripe";
import { db, authenticate, requireRole, ValidationError, ConflictError, NotFoundError, AppError, getConfig } from "@boilerdeck/shared";

export const developerRouter = Router();

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = getConfig().STRIPE_SECRET_KEY;
    if (!key) {
      throw new AppError(500, "Stripe is not configured — set STRIPE_SECRET_KEY in .env");
    }
    _stripe = new Stripe(key);
  }
  return _stripe;
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

      // Create an account link for onboarding
      const returnUrl = config.STRIPE_CONNECT_RETURN_URL
        || `${config.CORS_ORIGIN}/api/developer/stripe/onboard/return`;
      const refreshUrl = config.STRIPE_CONNECT_REFRESH_URL
        || `${config.CORS_ORIGIN}/api/developer/stripe/onboard/refresh`;

      const accountLink = await stripe.accountLinks.create({
        account: stripeAccountId,
        return_url: returnUrl,
        refresh_url: refreshUrl,
        type: "account_onboarding",
      });

      res.json({ url: accountLink.url });
    } catch (err) {
      next(err);
    }
  },
);

// Stripe Connect onboarding return — check status and redirect to dev portal
developerRouter.get(
  "/developer/stripe/onboard/return",
  authenticate,
  requireRole("DEVELOPER"),
  async (req, res, next) => {
    try {
      const developer = await db.developer.findUnique({
        where: { userId: req.user!.sub },
      });

      if (!developer || !developer.stripeAccountId) {
        throw new NotFoundError("Developer profile");
      }

      const stripe = getStripe();
      const account = await stripe.accounts.retrieve(developer.stripeAccountId);

      await db.developer.update({
        where: { id: developer.id },
        data: {
          stripeOnboarded: account.charges_enabled ?? false,
          stripePayoutsEnabled: account.payouts_enabled ?? false,
        },
      });

      // Redirect to dev portal dashboard
      const config = getConfig();
      const dashboardUrl = config.CORS_ORIGIN.includes("/dev")
        ? `${config.CORS_ORIGIN}/#/dashboard`
        : `${config.CORS_ORIGIN}/dev/#/dashboard`;
      res.redirect(dashboardUrl);
    } catch (err) {
      next(err);
    }
  },
);

// Stripe Connect onboarding refresh — generate new link (previous one expired)
developerRouter.get(
  "/developer/stripe/onboard/refresh",
  authenticate,
  requireRole("DEVELOPER"),
  async (req, res, next) => {
    try {
      const developer = await db.developer.findUnique({
        where: { userId: req.user!.sub },
      });

      if (!developer || !developer.stripeAccountId) {
        throw new NotFoundError("Developer profile");
      }

      const stripe = getStripe();
      const config = getConfig();

      const returnUrl = config.STRIPE_CONNECT_RETURN_URL
        || `${config.CORS_ORIGIN}/api/developer/stripe/onboard/return`;
      const refreshUrl = config.STRIPE_CONNECT_REFRESH_URL
        || `${config.CORS_ORIGIN}/api/developer/stripe/onboard/refresh`;

      const accountLink = await stripe.accountLinks.create({
        account: developer.stripeAccountId,
        return_url: returnUrl,
        refresh_url: refreshUrl,
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
