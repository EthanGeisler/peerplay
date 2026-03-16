import { db, NotFoundError, ConflictError, ValidationError } from "@peerplay/shared";

const PLATFORM_FEE_PERCENT = 1; // 1% platform fee

export async function checkout(userId: string, gameId: string) {
  // 1. Verify game exists and is published
  const game = await db.game.findUnique({ where: { id: gameId } });
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
  const platformFeeCents = Math.ceil(
    (game.priceCents * PLATFORM_FEE_PERCENT) / 100,
  );

  // TODO: Integrate real Stripe checkout session here.
  // For now, create the payment and license directly as a mock flow.

  // 4. Create Payment record and License in a transaction
  const result = await db.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        userId,
        gameId,
        amountCents: game.priceCents,
        platformFeeCents,
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

  // 5. Return confirmation
  return {
    paymentId: result.payment.id,
    licenseId: result.license.id,
    amountCents: result.payment.amountCents,
    platformFeeCents: result.payment.platformFeeCents,
    status: result.payment.status,
    gameId: game.id,
    gameTitle: game.title,
  };
}

export async function handleWebhook(rawBody: Buffer | string, signature: string | undefined) {
  // TODO: Implement real Stripe webhook verification and handling.
  // This stub logs the event for future integration.
  console.log("[Payment Webhook] Received event", {
    bodyLength: typeof rawBody === "string" ? rawBody.length : rawBody.byteLength,
    hasSignature: !!signature,
  });

  return { received: true };
}
