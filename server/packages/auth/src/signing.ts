/**
 * Server-side event signing service.
 *
 * Signs NIP-01 events on behalf of custodial users using their cached
 * signing key from Redis. Self-custody users must sign client-side.
 */

import * as crypto from "node:crypto";
import {
  db,
  redis,
  getConfig,
  UnauthorizedError,
  createEvent,
  type SignedEvent,
} from "@boilerdeck/shared";

// ─── Cache decryption ────────────────────────────────────────────────

function decryptFromCache(cached: string, keyHex: string): Uint8Array {
  const parts = cached.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid cache format");
  }

  const nonce = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const ciphertext = Buffer.from(parts[2], "hex");
  const key = Buffer.from(keyHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);

  return new Uint8Array(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]),
  );
}

// ─── Signing ─────────────────────────────────────────────────────────

/**
 * Sign an event on behalf of a user.
 *
 * Loads the user's cached signing key from Redis, decrypts it, and
 * creates a fully signed NIP-01 event.
 *
 * @throws UnauthorizedError if:
 *   - User is in SELF_CUSTODY mode (must sign client-side)
 *   - No cached signing key in Redis (session expired, re-login required)
 *   - Cached key cannot be decrypted (SIGNING_CACHE_KEY rotated)
 */
export async function signEventForUser(
  userId: string,
  params: { kind: number; tags: string[][]; content: string },
): Promise<SignedEvent> {
  // Load user to get pubkey and custody mode
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { nostrPubkey: true, custodyMode: true },
  });

  if (!user || !user.nostrPubkey) {
    throw new UnauthorizedError(
      "User has no cryptographic identity. Register or log in to generate a keypair.",
    );
  }

  if (user.custodyMode === "SELF_CUSTODY") {
    throw new UnauthorizedError(
      "Self-custody users must sign events client-side. Use the Electron client or sign with your private key directly.",
    );
  }

  // Load cached signing key from Redis
  const cached = await redis.get(`signing_key:${userId}`);
  if (!cached) {
    throw new UnauthorizedError(
      "Signing key not cached. Your session may have expired — please log in again.",
    );
  }

  // Decrypt the cached key
  let privateKey: Uint8Array;
  try {
    const config = getConfig();
    privateKey = decryptFromCache(cached, config.SIGNING_CACHE_KEY);
  } catch {
    throw new UnauthorizedError(
      "Failed to decrypt signing key. Your session may have expired — please log in again.",
    );
  }

  // Create and sign the event
  const event = createEvent(
    {
      pubkey: user.nostrPubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: params.kind,
      tags: params.tags,
      content: params.content,
    },
    privateKey,
  );

  return event;
}
