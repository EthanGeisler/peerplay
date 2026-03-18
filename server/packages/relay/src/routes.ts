/**
 * Relay REST routes for event management, key management, and profiles.
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
 *
 * Profile routes:
 * - PUT /profiles/me — set/update profile (authenticated, creates kind 0 event)
 * - GET /profiles/:pubkey — get profile data from latest kind 0 event (public)
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
import { federateOutbound, getExternalRelayUrls } from "./federation.js";
import { KIND_PROFILE, KIND_REVIEW, KIND_FOLLOW_LIST } from "./kinds.js";

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

// ── PUT /profiles/me — set/update user profile ──────────────────────────────

relayRouter.put("/profiles/me", authenticate, async (req, res, next) => {
  try {
    const { name, about, picture } = req.body;

    // Validate input: all fields optional but must be strings if present
    if (name !== undefined && typeof name !== "string") {
      throw new ValidationError("name must be a string");
    }
    if (about !== undefined && typeof about !== "string") {
      throw new ValidationError("about must be a string");
    }
    if (picture !== undefined && typeof picture !== "string") {
      throw new ValidationError("picture must be a string");
    }

    // Load user to get pubkey and displayName
    const user = await db.user.findUnique({
      where: { id: req.user!.sub },
      select: { nostrPubkey: true, displayName: true },
    });

    if (!user?.nostrPubkey) {
      throw new UnauthorizedError(
        "User has no cryptographic identity. Log in to generate a keypair.",
      );
    }

    // Check if this is the first profile creation (no existing kind 0 event)
    const existingProfiles = await queryEvents({
      kinds: [KIND_PROFILE],
      authors: [user.nostrPubkey],
      limit: 1,
    });

    const isFirstProfile = existingProfiles.length === 0;

    // Build profile content — seed name from displayName on first creation
    const profileContent: Record<string, string> = {};
    if (name !== undefined) {
      profileContent.name = name;
    } else if (isFirstProfile && user.displayName) {
      // Migration: seed from existing displayName on first profile creation
      profileContent.name = user.displayName;
    }
    if (about !== undefined) {
      profileContent.about = about;
    }
    if (picture !== undefined) {
      profileContent.picture = picture;
    }

    // Create and sign the kind 0 event
    const event = await signEventForUser(req.user!.sub, {
      kind: KIND_PROFILE,
      tags: [],
      content: JSON.stringify(profileContent),
    });

    // Store event (replaceable — will replace any existing kind 0 for this pubkey)
    await storeEvent(event);

    // Broadcast to WebSocket subscribers
    fanOutEvent(event);

    // Forward to external relays
    federateOutbound(event);

    res.json(profileContent);
  } catch (err) {
    next(err);
  }
});

// ── GET /profiles/:pubkey — get profile data ────────────────────────────────

relayRouter.get("/profiles/:pubkey", async (req, res, next) => {
  try {
    const { pubkey } = req.params;

    // Validate pubkey format (64-char hex)
    if (!pubkey || pubkey.length !== 64 || !/^[0-9a-f]+$/i.test(pubkey)) {
      throw new ValidationError("pubkey must be a 64-character hex string");
    }

    // Query latest kind 0 event for this pubkey
    const events = await queryEvents({
      kinds: [KIND_PROFILE],
      authors: [pubkey],
      limit: 1,
    });

    if (events.length === 0) {
      throw new NotFoundError("Profile");
    }

    const event = events[0]!;
    let profileData: Record<string, unknown>;
    try {
      profileData = JSON.parse(event.content);
    } catch {
      profileData = {};
    }

    res.json({
      pubkey: event.pubkey,
      ...profileData,
      created_at: event.created_at,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /games/:slug/reviews — submit a review ─────────────────────────────

relayRouter.post("/games/:slug/reviews", authenticate, async (req, res, next) => {
  try {
    const slug = String(req.params.slug);
    const { rating, title, body } = req.body;

    // Validate rating: must be an integer 1-5
    if (
      typeof rating !== "number" ||
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      throw new ValidationError(
        "rating must be an integer between 1 and 5",
      );
    }

    // Validate title and body: required strings
    if (typeof title !== "string" || title.length === 0) {
      throw new ValidationError("title is required and must be a non-empty string");
    }
    if (typeof body !== "string" || body.length === 0) {
      throw new ValidationError("body is required and must be a non-empty string");
    }

    // Look up the game by slug
    const game = await db.game.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!game) {
      throw new NotFoundError("Game");
    }

    // Check license ownership — user must own this game with ACTIVE status
    const license = await db.license.findUnique({
      where: {
        userId_gameId: {
          userId: req.user!.sub,
          gameId: game.id,
        },
      },
      select: { status: true },
    });

    if (!license || license.status !== "ACTIVE") {
      throw new ForbiddenError(
        "You must own this game to submit a review",
      );
    }

    // Create kind 31337 event: parameterized replaceable on d tag (one review per user per game)
    const content = JSON.stringify({ rating, title, body });
    const event = await signEventForUser(req.user!.sub, {
      kind: KIND_REVIEW,
      tags: [["d", slug]],
      content,
    });

    // Store event (replaceable semantics: same pubkey + kind 31337 + d=slug → replaces)
    await storeEvent(event);

    // Broadcast to WebSocket subscribers
    fanOutEvent(event);

    // Forward to external relays
    federateOutbound(event);

    // Parse content back for response
    res.status(201).json({
      eventId: event.id,
      pubkey: event.pubkey,
      rating,
      title,
      body,
      created_at: event.created_at,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /games/:slug/reviews — get reviews for a game ────────────────────────

relayRouter.get("/games/:slug/reviews", async (req, res, next) => {
  try {
    const slug = String(req.params.slug);
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;

    // Verify the game exists
    const game = await db.game.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!game) {
      throw new NotFoundError("Game");
    }

    // Query kind 31337 events with dTag = slug directly via Prisma
    // (queryEvents doesn't support dTag filtering)
    const clampedLimit = Math.min(Math.max(limit, 1), 100);
    const clampedOffset = Math.max(offset, 0);

    const [reviewEvents, totalCount] = await Promise.all([
      db.event.findMany({
        where: {
          kind: KIND_REVIEW,
          dTag: slug,
        },
        orderBy: { createdAt: "desc" },
        take: clampedLimit,
        skip: clampedOffset,
      }),
      db.event.count({
        where: {
          kind: KIND_REVIEW,
          dTag: slug,
        },
      }),
    ]);

    // Parse review content from events and compute aggregation
    const reviews = reviewEvents.map((e) => {
      let parsed: { rating?: number; title?: string; body?: string } = {};
      try {
        parsed = JSON.parse(e.content);
      } catch {
        // malformed content — return defaults
      }
      return {
        eventId: e.id,
        pubkey: e.pubkey,
        rating: parsed.rating ?? 0,
        title: parsed.title ?? "",
        body: parsed.body ?? "",
        created_at: e.createdAt,
      };
    });

    // Compute average rating across ALL reviews for this game (not just this page)
    let averageRating = 0;
    if (totalCount > 0) {
      // Fetch all reviews for aggregation (they're replaceable, so count is bounded by unique users)
      const allReviews = await db.event.findMany({
        where: {
          kind: KIND_REVIEW,
          dTag: slug,
        },
        select: { content: true },
      });

      let ratingSum = 0;
      let ratingCount = 0;
      for (const r of allReviews) {
        try {
          const parsed = JSON.parse(r.content);
          if (typeof parsed.rating === "number" && parsed.rating >= 1 && parsed.rating <= 5) {
            ratingSum += parsed.rating;
            ratingCount++;
          }
        } catch {
          // skip malformed
        }
      }
      averageRating = ratingCount > 0 ? ratingSum / ratingCount : 0;
    }

    res.json({
      reviews,
      averageRating,
      reviewCount: totalCount,
      limit: clampedLimit,
      offset: clampedOffset,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /follows — follow a user (add to kind 3 event) ─────────────────────

relayRouter.post("/follows", authenticate, async (req, res, next) => {
  try {
    const { pubkey: targetPubkey } = req.body;

    // Validate target pubkey
    if (
      !targetPubkey ||
      typeof targetPubkey !== "string" ||
      targetPubkey.length !== 64 ||
      !/^[0-9a-f]+$/i.test(targetPubkey)
    ) {
      throw new ValidationError(
        "pubkey must be a 64-character hex string",
      );
    }

    // Load user's pubkey
    const user = await db.user.findUnique({
      where: { id: req.user!.sub },
      select: { nostrPubkey: true },
    });

    if (!user?.nostrPubkey) {
      throw new UnauthorizedError(
        "User has no cryptographic identity. Log in to generate a keypair.",
      );
    }

    // Prevent self-follow
    if (user.nostrPubkey === targetPubkey.toLowerCase()) {
      throw new ValidationError("Cannot follow yourself");
    }

    // Load existing kind 3 event for this user (if any)
    const existingEvents = await queryEvents({
      kinds: [KIND_FOLLOW_LIST],
      authors: [user.nostrPubkey],
      limit: 1,
    });

    // Build updated tags from existing event + new follow
    let tags: string[][] = [];
    if (existingEvents.length > 0) {
      tags = existingEvents[0]!.tags.filter(
        (t) => t[0] === "p" && typeof t[1] === "string" && t[1].length > 0,
      );
    }

    // Add target if not already present
    const alreadyFollowing = tags.some(
      (t) => t[1]?.toLowerCase() === targetPubkey.toLowerCase(),
    );
    if (!alreadyFollowing) {
      tags.push(["p", targetPubkey.toLowerCase()]);
    }

    // Create new kind 3 event with updated tags
    const event = await signEventForUser(req.user!.sub, {
      kind: KIND_FOLLOW_LIST,
      tags,
      content: "",
    });

    // Store event (replaceable — replaces existing kind 3 for this pubkey)
    await storeEvent(event);

    // Broadcast + federate
    fanOutEvent(event);
    federateOutbound(event);

    // Return updated follow list
    const follows = tags
      .filter((t) => t[0] === "p")
      .map((t) => t[1]!);

    res.json({ follows });
  } catch (err) {
    next(err);
  }
});

// ── GET /follows/:pubkey — get follow list for a user ────────────────────────

relayRouter.get("/follows/:pubkey", async (req, res, next) => {
  try {
    const { pubkey } = req.params;

    // Validate pubkey format (64-char hex)
    if (!pubkey || pubkey.length !== 64 || !/^[0-9a-f]+$/i.test(pubkey)) {
      throw new ValidationError("pubkey must be a 64-character hex string");
    }

    // Query latest kind 3 event for this pubkey
    const events = await queryEvents({
      kinds: [KIND_FOLLOW_LIST],
      authors: [pubkey],
      limit: 1,
    });

    // Return empty list if no kind 3 event exists (not 404)
    if (events.length === 0) {
      res.json({ follows: [] });
      return;
    }

    // Extract followed pubkeys from p tags
    const follows = events[0]!.tags
      .filter((t) => t[0] === "p" && typeof t[1] === "string" && t[1].length > 0)
      .map((t) => t[1]!);

    res.json({ follows });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /follows/:pubkey — unfollow a user ────────────────────────────────

relayRouter.delete("/follows/:pubkey", authenticate, async (req, res, next) => {
  try {
    const targetPubkey = String(req.params.pubkey);

    // Validate target pubkey format
    if (targetPubkey.length !== 64 || !/^[0-9a-f]+$/i.test(targetPubkey)) {
      throw new ValidationError("pubkey must be a 64-character hex string");
    }

    // Load user's pubkey
    const user = await db.user.findUnique({
      where: { id: req.user!.sub },
      select: { nostrPubkey: true },
    });

    if (!user?.nostrPubkey) {
      throw new UnauthorizedError(
        "User has no cryptographic identity. Log in to generate a keypair.",
      );
    }

    // Load existing kind 3 event for this user
    const existingEvents = await queryEvents({
      kinds: [KIND_FOLLOW_LIST],
      authors: [user.nostrPubkey],
      limit: 1,
    });

    // Build updated tags without the target pubkey
    let tags: string[][] = [];
    if (existingEvents.length > 0) {
      tags = existingEvents[0]!.tags.filter(
        (t) =>
          t[0] === "p" &&
          typeof t[1] === "string" &&
          t[1].length > 0 &&
          t[1].toLowerCase() !== targetPubkey.toLowerCase(),
      );
    }

    // Create new kind 3 event with updated tags (even if empty — replaces old)
    const event = await signEventForUser(req.user!.sub, {
      kind: KIND_FOLLOW_LIST,
      tags,
      content: "",
    });

    // Store event (replaceable)
    await storeEvent(event);

    // Broadcast + federate
    fanOutEvent(event);
    federateOutbound(event);

    // Return updated follow list
    const follows = tags
      .filter((t) => t[0] === "p")
      .map((t) => t[1]!);

    res.json({ follows });
  } catch (err) {
    next(err);
  }
});

// ── Relay info helper ───────────────────────────────────────────────────────

function buildRelayInfo(): Record<string, unknown> {
  return {
    name: "BoilerDeck Relay",
    description: "Nostr-compatible relay for the BoilerDeck decentralized game distribution platform",
    relay_url: "wss://boilerdeck.com/relay",
    supported_nips: [1, 11],
    software: "boilerdeck-relay",
    version: "0.1.0",
    limitation: {
      max_message_length: 1024 * 1024,
      max_subscriptions: 20,
      max_filters: 10,
      max_event_tags: 1000,
    },
    external_relays: getExternalRelayUrls(),
  };
}

// ── GET /relay/info — relay metadata (REST) ─────────────────────────────────

relayRouter.get("/relay/info", (_req, res) => {
  res.json(buildRelayInfo());
});

// ── NIP-11 Router ───────────────────────────────────────────────────────────
// Separate router for /relay path — handles NIP-11 info document requests.
// Must be mounted at the root level (not under /api) so it catches GET /relay.
// Regular WebSocket upgrade requests fall through to the ws library.

export const nip11Router = Router();

nip11Router.get("/relay", (req, res, next) => {
  const accept = req.headers.accept || "";
  if (accept.includes("application/nostr+json")) {
    res.setHeader("Content-Type", "application/nostr+json");
    res.json(buildRelayInfo());
    return;
  }
  // Not a NIP-11 request — let it fall through to WebSocket upgrade
  next();
});
