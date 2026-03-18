/**
 * Relay-specific types for NIP-01 WebSocket protocol.
 *
 * These extend the base event types from @boilerdeck/shared with
 * relay protocol concerns: subscriptions, filters, and message framing.
 */

import type { SignedEvent } from "@boilerdeck/shared";

// ─── Core Types ──────────────────────────────────────────────────────

/** A relay event is a signed NIP-01 event — same shape, explicit alias for relay context. */
export type RelayEvent = SignedEvent;

/** Filter for querying or subscribing to events (NIP-01 compatible). */
export interface EventFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  /** Event references — matches events with an "e" tag containing any of these IDs. */
  "#e"?: string[];
  /** Pubkey references — matches events with a "p" tag containing any of these pubkeys. */
  "#p"?: string[];
  since?: number;
  until?: number;
  limit?: number;
}

/** An active subscription on a WebSocket connection. */
export interface Subscription {
  id: string;
  filters: EventFilter[];
  /** The WebSocket connection that owns this subscription. */
  connectionId: string;
}

// ─── NIP-01 Protocol Messages ────────────────────────────────────────

/** Client → Relay: request events matching filters. */
export type ClientReqMessage = ["REQ", string, ...EventFilter[]];

/** Client → Relay: publish a signed event. */
export type ClientEventMessage = ["EVENT", SignedEvent];

/** Client → Relay: close a subscription. */
export type ClientCloseMessage = ["CLOSE", string];

/** Any valid client-to-relay message. */
export type ClientMessage = ClientReqMessage | ClientEventMessage | ClientCloseMessage;

/** Relay → Client: an event matching a subscription. */
export type RelayEventMessage = ["EVENT", string, SignedEvent];

/** Relay → Client: end of stored events for a subscription. */
export type RelayEoseMessage = ["EOSE", string];

/** Relay → Client: acknowledgment of a published event. */
export type RelayOkMessage = ["OK", string, boolean, string];

/** Relay → Client: human-readable notice. */
export type RelayNoticeMessage = ["NOTICE", string];

/** Any valid relay-to-client message. */
export type RelayMessage =
  | RelayEventMessage
  | RelayEoseMessage
  | RelayOkMessage
  | RelayNoticeMessage;
