/**
 * Event materialization layer — converts NIP-01 events into legacy DB rows.
 *
 * - Kind 30001 → upsert Game row (using slug from d tag, content fields)
 * - Kind 30002 → upsert GameVersion row
 * - Other kinds → silent no-op
 *
 * Idempotent: materializing the same event twice produces no error or duplicate.
 */

import { db } from "./db.js";
import {
  EVENT_KIND_GAME_LISTING,
  EVENT_KIND_GAME_VERSION,
  extractDTag,
  type SignedEvent,
} from "./events.js";

/**
 * Materialize an event into legacy database tables.
 * Returns a string indicating what happened.
 */
export async function materializeEvent(
  event: SignedEvent,
): Promise<"MATERIALIZED" | "SKIPPED" | "NO_OP"> {
  switch (event.kind) {
    case EVENT_KIND_GAME_LISTING:
      return materializeGameListing(event);
    case EVENT_KIND_GAME_VERSION:
      return materializeGameVersion(event);
    default:
      return "NO_OP";
  }
}

// ── Kind 30001: Game Listing ─────────────────────────────────────────────────

async function materializeGameListing(event: SignedEvent): Promise<"MATERIALIZED" | "SKIPPED"> {
  const slug = extractDTag(event.tags);
  if (!slug) {
    return "SKIPPED"; // No slug in d tag — can't materialize
  }

  // Parse content
  let content: { title?: string; description?: string; priceCents?: number; slug?: string };
  try {
    content = JSON.parse(event.content);
  } catch {
    return "SKIPPED"; // Malformed content JSON
  }

  if (!content.title || typeof content.title !== "string") {
    return "SKIPPED"; // Missing required title
  }

  // Find developer by pubkey
  const user = await db.user.findUnique({
    where: { nostrPubkey: event.pubkey },
    select: { developer: { select: { id: true } } },
  });

  if (!user?.developer) {
    return "SKIPPED"; // No developer account for this pubkey
  }

  const developerId = user.developer.id;

  // Check for slug collision from different developer
  const existingGame = await db.listing.findUnique({
    where: { slug },
    select: { developerId: true, id: true },
  });

  if (existingGame && existingGame.developerId !== developerId) {
    return "SKIPPED"; // Slug belongs to a different developer
  }

  // Extract status tag
  const statusTag = event.tags.find((t) => t[0] === "status");
  const status = statusTag?.[1] === "PUBLISHED" ? "PUBLISHED" : "DRAFT";

  // Upsert game
  await db.listing.upsert({
    where: { slug },
    create: {
      developerId,
      slug,
      title: content.title,
      description: content.description ?? "",
      priceCents: content.priceCents ?? 0,
      status: status as "DRAFT" | "PUBLISHED",
      eventId: event.id,
    },
    update: {
      title: content.title,
      description: content.description ?? "",
      priceCents: content.priceCents ?? 0,
      status: status as "DRAFT" | "PUBLISHED",
      eventId: event.id,
    },
  });

  return "MATERIALIZED";
}

// ── Kind 30002: Game Version ─────────────────────────────────────────────────

async function materializeGameVersion(event: SignedEvent): Promise<"MATERIALIZED" | "SKIPPED"> {
  const dTag = extractDTag(event.tags);
  if (!dTag || !dTag.includes(":")) {
    return "SKIPPED"; // Invalid d tag format (expected slug:version)
  }

  const [slug, version] = dTag.split(":", 2);
  if (!slug || !version) {
    return "SKIPPED";
  }

  // Parse content
  let content: { version?: string; fileSizeBytes?: number; infoHash?: string | null };
  try {
    content = JSON.parse(event.content);
  } catch {
    return "SKIPPED"; // Malformed content JSON
  }

  // Find the game by slug
  const game = await db.listing.findUnique({
    where: { slug },
    select: { id: true, developerId: true },
  });

  if (!game) {
    return "SKIPPED"; // Game doesn't exist yet (out-of-order event)
  }

  // Verify the event author owns this game (via pubkey -> developer)
  const user = await db.user.findUnique({
    where: { nostrPubkey: event.pubkey },
    select: { developer: { select: { id: true } } },
  });

  if (!user?.developer || user.developer.id !== game.developerId) {
    return "SKIPPED"; // Wrong developer
  }

  // Upsert game version (idempotent by gameId + version unique constraint)
  try {
    await db.listingVersion.upsert({
      where: {
        gameId_version: { gameId: game.id, version },
      },
      create: {
        gameId: game.id,
        version,
        fileSizeBytes: content.fileSizeBytes ?? 0,
        status: "READY",
      },
      update: {
        fileSizeBytes: content.fileSizeBytes ?? 0,
      },
    });
  } catch {
    // Ignore errors (e.g., constraint violations from concurrent ops)
    return "SKIPPED";
  }

  return "MATERIALIZED";
}
