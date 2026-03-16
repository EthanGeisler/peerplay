import Stripe from "stripe";
import { db, NotFoundError, ConflictError, ValidationError, AppError, getConfig } from "@boilerdeck/shared";

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

export async function checkout(userId: string, gameId: string) {
  // 1. Verify game exists and is published
  const game = await db.game.findUnique({
    where: { id: gameId },
    include: { developer: true },
  });
  if (!game) {
    throw new NotFoundError("Game");
  }
  if (game.status !== "PUBLISHED") {
    throw new ValidationError("Game is not available for purchase");
  }

  // 2. Check user doesn't already own it
  const existingLicense = await db.license.findUnique({
    where: { userId_gameId: { userId, gameId } },
  });
  if (existingLicense && existingLicense.status === "ACTIVE") {
    throw new ConflictError("You already own this game");
  }

  // 3. Calculate platform fee
  const config = getConfig();
  const platformFeePercent = config.STRIPE_PLATFORM_FEE_PERCENT;
  const platformFeeCents = Math.ceil(
    (game.priceCents * platformFeePercent) / 100,
  );

  // 4. Free games: grant license immediately (no Stripe)
  if (game.priceCents === 0) {
    const result = await db.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          userId,
          gameId,
          amountCents: 0,
          platformFeeCents: 0,
          status: "COMPLETED",
        },
      });

      const license = await tx.license.create({
        data: {
          userId,
          gameId,
          paymentId: payment.id,
          status: "ACTIVE",
        },
      });

      return { payment, license };
    });

    return {
      free: true,
      paymentId: result.payment.id,
      licenseId: result.license.id,
      gameId: game.id,
      gameTitle: game.title,
    };
  }

  // 5. Paid games: create Stripe Checkout Session
  if (!game.developer.stripeAccountId) {
    throw new ValidationError("This game's developer has not completed payment setup");
  }

  const stripe = getStripe();

  // Create a PENDING payment record first
  const payment = await db.payment.create({
    data: {
      userId,
      gameId,
      amountCents: game.priceCents,
      platformFeeCents,
      status: "PENDING",
    },
  });

  // Determine success/cancel URLs for Stripe Checkout
  // The storefront uses HashRouter, so URLs look like http://host/#/path
  const origin = config.CORS_ORIGIN;
  const successUrl = `${origin}/#/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${origin}/#/checkout/cancel`;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: game.title,
          },
          unit_amount: game.priceCents,
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      application_fee_amount: platformFeeCents,
      transfer_data: {
        destination: game.developer.stripeAccountId,
      },
    },
    metadata: {
      paymentId: payment.id,
      gameId: game.id,
      userId,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  // Store the checkout session ID on the payment record
  await db.payment.update({
    where: { id: payment.id },
    data: { stripeCheckoutSessionId: session.id },
  });

  return {
    free: false,
    checkoutUrl: session.url,
    paymentId: payment.id,
    gameId: game.id,
    gameTitle: game.title,
  };
}

export async function handleWebhook(rawBody: Buffer | string, signature: string | undefined) {
  const config = getConfig();
  if (!config.STRIPE_WEBHOOK_SECRET) {
    throw new AppError(500, "Stripe webhook secret is not configured");
  }

  const stripe = getStripe();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature!,
      config.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    throw new ValidationError(`Webhook signature verification failed: ${(err as Error).message}`);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    }
    case "checkout.session.expired": {
      await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
      break;
    }
    case "account.updated": {
      await handleAccountUpdated(event.data.object as Stripe.Account);
      break;
    }
    default:
      console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
  }

  return { received: true };
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const paymentId = session.metadata?.paymentId;
  if (!paymentId) {
    console.error("[Stripe Webhook] checkout.session.completed missing paymentId in metadata");
    return;
  }

  // Idempotency: skip if already completed
  const existing = await db.payment.findUnique({ where: { id: paymentId } });
  if (!existing || existing.status === "COMPLETED") {
    return;
  }

  await db.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: "COMPLETED",
        stripePaymentIntentId: typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null,
      },
    });

    // Check license doesn't already exist (idempotency)
    const existingLicense = await tx.license.findUnique({
      where: { userId_gameId: { userId: existing.userId, gameId: existing.gameId } },
    });
    if (!existingLicense) {
      await tx.license.create({
        data: {
          userId: existing.userId,
          gameId: existing.gameId,
          paymentId: existing.id,
          status: "ACTIVE",
        },
      });
    }
  });

  console.log(`[Stripe Webhook] Payment ${paymentId} completed, license granted`);
}

async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
  const paymentId = session.metadata?.paymentId;
  if (!paymentId) return;

  await db.payment.update({
    where: { id: paymentId },
    data: { status: "FAILED" },
  });

  console.log(`[Stripe Webhook] Payment ${paymentId} expired`);
}

async function handleAccountUpdated(account: Stripe.Account) {
  // Find developer by stripeAccountId and update onboarding status
  const developer = await db.developer.findFirst({
    where: { stripeAccountId: account.id },
  });
  if (!developer) return;

  await db.developer.update({
    where: { id: developer.id },
    data: {
      stripeOnboarded: account.charges_enabled ?? false,
      stripePayoutsEnabled: account.payouts_enabled ?? false,
    },
  });

  console.log(`[Stripe Webhook] Developer ${developer.id} account updated — charges: ${account.charges_enabled}, payouts: ${account.payouts_enabled}`);
}
