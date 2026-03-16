import { Router } from "express";
import { z, ZodError } from "zod";
import { db, authenticate, requireRole, ValidationError, ConflictError, NotFoundError, getConfig } from "@peerplay/shared";

export const developerRouter = Router();

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

// Get Stripe Connect onboarding URL (stub — returns placeholder)
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

      // TODO: Create real Stripe Connect account link
      // const stripe = new Stripe(getConfig().STRIPE_SECRET_KEY);
      // const account = await stripe.accounts.create({ type: 'express' });
      // const link = await stripe.accountLinks.create({...});

      res.json({
        url: "https://connect.stripe.com/setup/placeholder",
        message: "Stripe Connect integration pending — this is a stub",
      });
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
