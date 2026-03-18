/**
 * Event storage service — stores, retrieves, and queries NIP-01 events.
 *
 * Handles:
 * - Signature verification before storage
 * - Duplicate detection (by event ID)
 * - Replaceable event semantics (kinds 0, 3, 10000-19999, 30000-39999: newest wins by created_at)
 * - dTag normalization (replaceable kinds → "", parameterized → d tag value, regular → null)
 */

import type { Event as PrismaEvent } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { db } from "./db.js";
import {
  verifyEvent,
  normalizeDTag,
  isReplaceableKind,
  type SignedEvent,
} from "./events.js";
import { ValidationError } from "./errors.js";

// ─── Constants ───────────────────────────────────────────────────────

const MAX_QUERY_LIMIT = 500;
const DEFAULT_QUERY_LIMIT = 100;

// ─── Types ───────────────────────────────────────────────────────────

export type StoreResult = "STORED" | "DUPLICATE" | "REPLACED";

export interface EventFilter {
  kinds?: number[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
}

// ─── Conversion helpers ──────────────────────────────────────────────

/** Convert a Prisma Event row to a SignedEvent (NIP-01 shape). */
function toSignedEvent(row: PrismaEvent): SignedEvent {
  return {
    id: row.id,
    pubkey: row.pubkey,
    created_at: row.createdAt,
    kind: row.kind,
    tags: row.tags as string[][],
    content: row.content,
    sig: row.sig,
  };
}

// ─── Store ───────────────────────────────────────────────────────────

/**
 * Store a signed event after verifying its signature and ID.
 *
 * - Invalid signature or mismatched ID → throws ValidationError
 * - Duplicate event ID → returns "DUPLICATE"
 * - Replaceable kind with older created_at → returns "DUPLICATE" (keeps newer)
 * - Replaceable kind with newer created_at → replaces old, returns "REPLACED"
 */
export async function storeEvent(event: SignedEvent): Promise<StoreResult> {
  // Verify signature and ID integrity
  if (!verifyEvent(event)) {
    throw new ValidationError(
      "Invalid event: signature verification failed or event ID does not match content",
    );
  }

  const dTag = normalizeDTag(event.kind, event.tags);

  // Handle replaceable events (kinds 0, 3, 10000-19999, 30000-39999)
  if (isReplaceableKind(event.kind)) {
    return storeReplaceableEvent(event, dTag!);
  }

  // Regular event — just insert
  return insertEvent(event, dTag);
}

async function insertEvent(
  event: SignedEvent,
  dTag: string | null,
): Promise<StoreResult> {
  try {
    await db.event.create({
      data: {
        id: event.id,
        pubkey: event.pubkey,
        createdAt: event.created_at,
        kind: event.kind,
        tags: event.tags as Prisma.InputJsonValue,
        content: event.content,
        sig: event.sig,
        dTag,
      },
    });
    return "STORED";
  } catch (err) {
    // P2002 = unique constraint violation (duplicate id)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return "DUPLICATE";
    }
    throw err;
  }
}

async function storeReplaceableEvent(
  event: SignedEvent,
  dTag: string,
): Promise<StoreResult> {
  // Check for existing event with same pubkey+kind+dTag
  const existing = await db.event.findUnique({
    where: {
      pubkey_kind_dTag: {
        pubkey: event.pubkey,
        kind: event.kind,
        dTag,
      },
    },
  });

  if (!existing) {
    // No existing event — insert
    return insertEvent(event, dTag);
  }

  if (existing.id === event.id) {
    // Exact same event — duplicate
    return "DUPLICATE";
  }

  if (existing.createdAt >= event.created_at) {
    // Existing event is newer or same age — keep it
    return "DUPLICATE";
  }

  // New event is newer — replace
  await db.event.update({
    where: { id: existing.id },
    data: {
      id: event.id,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      kind: event.kind,
      tags: event.tags as Prisma.InputJsonValue,
      content: event.content,
      sig: event.sig,
      dTag,
    },
  });

  return "REPLACED";
}

// ─── Get ─────────────────────────────────────────────────────────────

/**
 * Fetch a single event by ID.
 * Returns null if not found.
 */
export async function getEvent(id: string): Promise<SignedEvent | null> {
  const row = await db.event.findUnique({ where: { id } });
  return row ? toSignedEvent(row) : null;
}

// ─── Query ───────────────────────────────────────────────────────────

/**
 * Query events with optional filters.
 *
 * - `kinds`: filter by event kind(s)
 * - `authors`: filter by pubkey(s)
 * - `since`: events with created_at >= since
 * - `until`: events with created_at <= until
 * - `limit`: max results (capped at 500, default 100). 0 or negative returns empty.
 *
 * Results ordered by created_at descending (newest first).
 */
export async function queryEvents(filter: EventFilter = {}): Promise<SignedEvent[]> {
  const limit = normalizeLimit(filter.limit);
  if (limit <= 0) return [];

  // since > until → empty result (not an error)
  if (
    filter.since !== undefined &&
    filter.until !== undefined &&
    filter.since > filter.until
  ) {
    return [];
  }

  const where: Prisma.EventWhereInput = {};

  if (filter.kinds && filter.kinds.length > 0) {
    where.kind = { in: filter.kinds };
  }

  if (filter.authors && filter.authors.length > 0) {
    where.pubkey = { in: filter.authors };
  }

  if (filter.since !== undefined) {
    where.createdAt = { ...where.createdAt as object, gte: filter.since };
  }

  if (filter.until !== undefined) {
    where.createdAt = { ...where.createdAt as object, lte: filter.until };
  }

  const rows = await db.event.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map(toSignedEvent);
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_QUERY_LIMIT;
  if (limit <= 0) return 0;
  return Math.min(limit, MAX_QUERY_LIMIT);
}
