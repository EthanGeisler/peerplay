/**
 * Relay event service — wraps shared event store with relay-specific operations.
 *
 * Delegates to @boilerdeck/shared for core storage, adds deleteEvent for relay admin ops.
 */

import {
  storeEvent as sharedStoreEvent,
  getEvent as sharedGetEvent,
  queryEvents as sharedQueryEvents,
  db,
} from "@boilerdeck/shared";
import type { SignedEvent, StoreResult, EventFilter } from "@boilerdeck/shared";

// ─── Re-exported core operations ─────────────────────────────────────

/** Store a signed event after verifying signature. Delegates to shared eventStore. */
export async function storeEvent(event: SignedEvent): Promise<StoreResult> {
  return sharedStoreEvent(event);
}

/** Fetch a single event by ID. */
export async function getEvent(id: string): Promise<SignedEvent | null> {
  return sharedGetEvent(id);
}

/** Query events with filters. */
export async function queryEvents(filter: EventFilter = {}): Promise<SignedEvent[]> {
  return sharedQueryEvents(filter);
}

// ─── Relay-specific operations ───────────────────────────────────────

export type DeleteResult = "DELETED" | "NOT_FOUND";

/**
 * Delete an event by ID.
 *
 * Used for:
 * - NIP-09 deletion events (kind 5) — author requests deletion of their own events
 * - Admin moderation — relay operator removes content
 *
 * Returns "DELETED" if the event was found and removed, "NOT_FOUND" otherwise.
 * Does NOT cascade to legacy tables (Game.eventId becomes a dangling ref → set to null).
 */
export async function deleteEvent(id: string): Promise<DeleteResult> {
  // Unlink any games referencing this event before deleting
  await db.game.updateMany({
    where: { eventId: id },
    data: { eventId: null },
  });

  const result = await db.event.deleteMany({
    where: { id },
  });

  return result.count > 0 ? "DELETED" : "NOT_FOUND";
}
