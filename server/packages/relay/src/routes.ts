/**
 * Relay REST routes for event management.
 *
 * These routes mirror the shared eventRoutes but live in the relay package
 * for Phase 3+ ownership. The shared eventRouter will be replaced by this
 * once the relay package is fully wired up.
 *
 * - POST /events — submit a pre-signed event (authenticated, pubkey must match)
 * - GET /events — query events (public)
 * - GET /events/:id — get single event by ID (public)
 */

import { Router } from "express";
import {
  authenticate,
  verifyEvent,
  db,
  ValidationError,
  ForbiddenError,
  NotFoundError,
  materializeEvent,
} from "@boilerdeck/shared";
import type { SignedEvent } from "@boilerdeck/shared";
import { storeEvent, getEvent, queryEvents } from "./service.js";

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
