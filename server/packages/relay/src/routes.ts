/**
 * Relay REST routes for event management and key management.
 *
 * Event routes:
 * - POST /events — submit a pre-signed event (authenticated, pubkey must match)
 * - GET /events — query events (public)
 * - GET /events/:id — get single event by ID (public)
 *
 * Key management routes:
 * - GET /relay/me/keys — export pubkey + privkey (authenticated, custodial only)
 * - POST /relay/me/import-key — import a private key, update pubkey (authenticated)
 *
 * Event signing routes:
 * - POST /events/sign-and-publish — server signs + stores + broadcasts (authenticated)
 */

import * as nodeCrypto from "node:crypto";
import { Router } from "express";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  authenticate,
  verifyEvent,
  db,
  redis,
  getConfig,
  ValidationError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  materializeEvent,
} from "@boilerdeck/shared";
import type { SignedEvent } from "@boilerdeck/shared";
import { signEventForUser } from "@boilerdeck/auth";
import { storeEvent, getEvent, queryEvents } from "./service.js";
import { fanOutEvent } from "./ws.js";
import { federateOutbound } from "./federation.js";

export const relayRouter = Router();

// ── Size limits ──────────────────────────────────────────────────────────────

const MAX_CONTENT_BYTES = 1024 * 1024; // 1MB
const MAX_TAGS = 1000;

// ── POST /events — submit pre-signed event ───────────────────────────────────

relayRouter.post("/events", authenticate, async (req, res, next) => {
  try {
    const event = req.body as SignedEvent;

    // Basic shape validation
    if (
      !event ||
      typeof event.id !== "string" ||
      typeof event.pubkey !== "string" ||
      typeof event.created_at !== "number" ||
      typeof event.kind !== "number" ||
      !Array.isArray(event.tags) ||
      typeof event.content !== "string" ||
      typeof event.sig !== "string"
    ) {
      throw new ValidationError(
        "Invalid event: must have id, pubkey, created_at, kind, tags, content, sig",
      );
    }

    // Size limits
    if (Buffer.byteLength(event.content, "utf8") > MAX_CONTENT_BYTES) {
      throw new ValidationError("Event content exceeds 1MB limit");
    }
    if (event.tags.length > MAX_TAGS) {
      throw new ValidationError("Event tags exceed 1000 limit");
    }

    // Verify signature
    if (!verifyEvent(event)) {
      throw new ValidationError(
        "Invalid event: signature verification failed or event ID does not match content",
      );
    }

    // Verify pubkey matches authenticated user
    const user = await db.user.findUnique({
      where: { id: req.user!.sub },
      select: { nostrPubkey: true },
    });

    if (!user?.nostrPubkey || user.nostrPubkey !== event.pubkey) {
      throw new ForbiddenError(
        "Event pubkey does not match your account's public key",
      );
    }

    // Store event
    await storeEvent(event);

    // Materialize into legacy tables (non-fatal)
    try {
      await materializeEvent(event);
    } catch (matErr) {
      console.warn("[relay] materializeEvent failed (non-fatal):", matErr);
    }

    // Forward to external relays
    federateOutbound(event);

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /events — query events ───────────────────────────────────────────────

relayRouter.get("/events", async (req, res, next) => {
  try {
    const kinds = req.query.kinds
      ? String(req.query.kinds)
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n))
      : undefined;

    const authors = req.query.authors
      ? String(req.query.authors)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const since = req.query.since ? parseInt(String(req.query.since), 10) : undefined;
    const until = req.query.until ? parseInt(String(req.query.until), 10) : undefined;

    const events = await queryEvents({ kinds, authors, limit, since, until });
    res.json(events);
  } catch (err) {
    next(err);
  }
});

// ── GET /events/:id — single event ──────────────────────────────────────────

relayRouter.get("/events/:id", async (req, res, next) => {
  try {
    const event = await getEvent(String(req.params.id));
    if (!event) {
      throw new NotFoundError("Event");
    }
    res.json(event);
  } catch (err) {
    next(err);
  }
});

// ── Cache decryption helper ─────────────────────────────────────────────────

function decryptFromCache(cached: string, keyHex: string): Uint8Array {
  const parts = cached.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid cache format");
  }

  const nonce = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const ciphertext = Buffer.from(parts[2], "hex");
  const key = Buffer.from(keyHex, "hex");

  const decipher = nodeCrypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);

  return new Uint8Array(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]),
  );
}

function encryptForCache(data: Uint8Array, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const nonce = nodeCrypto.randomBytes(12);
  const cipher = nodeCrypto.createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return nonce.toString("hex") + ":" + tag.toString("hex") + ":" + encrypted.toString("hex");
}

// ── GET /relay/me/keys — export pubkey + privkey ────────────────────────────

relayRouter.get("/relay/me/keys", authenticate, async (req, res, next) => {
  try {
    const user = await db.user.findUnique({
      where: { id: req.user!.sub },
      select: { nostrPubkey: true, custodyMode: true },
    });

    if (!user || !user.nostrPubkey) {
      throw new NotFoundError("No cryptographic identity found for this user");
    }

    if (user.custodyMode === "SELF_CUSTODY") {
      // Self-custody users: return pubkey only, no privkey on server
      res.json({ pubkey: user.nostrPubkey, privkey: null });
      return;
    }

    // Custodial users: decrypt privkey from Redis cache
    const config = getConfig();
    const cached = await redis.get(`signing_key:${req.user!.sub}`);
    if (!cached) {
      throw new UnauthorizedError(
        "Signing key not cached. Your session may have expired — please log in again.",
      );
    }

    let privateKey: Uint8Array;
    try {
      privateKey = decryptFromCache(cached, config.SIGNING_CACHE_KEY);
    } catch {
      throw new UnauthorizedError(
        "Failed to decrypt signing key. Please log in again.",
      );
    }

    res.json({
      pubkey: user.nostrPubkey,
      privkey: Buffer.from(privateKey).toString("hex"),
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /relay/me/import-key — import a private key ────────────────────────

relayRouter.post("/relay/me/import-key", authenticate, async (req, res, next) => {
  try {
    const { privkey } = req.body;

    if (!privkey || typeof privkey !== "string" || !/^[0-9a-f]{64}$/i.test(privkey)) {
      throw new ValidationError(
        "privkey must be a 64-character lowercase hex string (32 bytes)",
      );
    }

    const privkeyLower = privkey.toLowerCase();

    // Derive pubkey from privkey using secp256k1 Schnorr
    const privkeyBytes = new Uint8Array(Buffer.from(privkeyLower, "hex"));
    const pubkeyBytes = schnorr.getPublicKey(privkeyBytes);
    const newPubkey = Buffer.from(pubkeyBytes).toString("hex");

    // Update user's pubkey in DB
    await db.user.update({
      where: { id: req.user!.sub },
      data: {
        nostrPubkey: newPubkey,
        // Clear encrypted keys since we're importing a new key
        // The user is taking custody of this key
        encryptedNsec: null,
        encryptedMnemonic: null,
        custodyMode: "SELF_CUSTODY",
      },
    });

    // Cache the new signing key in Redis (encrypted)
    const config = getConfig();
    const cached = encryptForCache(privkeyBytes, config.SIGNING_CACHE_KEY);
    const ttl = 7 * 24 * 60 * 60; // 7 days (match refresh token TTL)
    await redis.set(`signing_key:${req.user!.sub}`, cached, "EX", ttl);

    res.json({ pubkey: newPubkey });
  } catch (err) {
    next(err);
  }
});

// ── POST /events/sign-and-publish — server signs + stores + broadcasts ──────

relayRouter.post("/events/sign-and-publish", authenticate, async (req, res, next) => {
  try {
    const { kind, content, tags } = req.body;

    // Validate input shape
    if (typeof kind !== "number" || !Number.isInteger(kind) || kind < 0) {
      throw new ValidationError("kind must be a non-negative integer");
    }
    if (typeof content !== "string") {
      throw new ValidationError("content must be a string");
    }
    if (!Array.isArray(tags)) {
      throw new ValidationError("tags must be an array of string arrays");
    }
    if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
      throw new ValidationError("Event content exceeds 1MB limit");
    }
    if (tags.length > MAX_TAGS) {
      throw new ValidationError("Event tags exceed 1000 limit");
    }

    // Sign the event using the user's cached signing key
    const event = await signEventForUser(req.user!.sub, {
      kind,
      tags: tags as string[][],
      content,
    });

    // Store the event
    await storeEvent(event);

    // Materialize into legacy tables (non-fatal)
    try {
      await materializeEvent(event);
    } catch (matErr) {
      console.warn("[relay] materializeEvent failed (non-fatal):", matErr);
    }

    // Broadcast to WebSocket subscribers
    fanOutEvent(event);

    // Forward to external relays
    federateOutbound(event);

    res.status(201).json(event);
  } catch (err) {
    next(err);
  }
});
