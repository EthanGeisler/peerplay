/**
 * NIP-01 WebSocket relay endpoint.
 *
 * Handles the Nostr relay protocol over WebSocket:
 * - REQ: subscribe to events matching filters (replays stored events + live)
 * - EVENT: publish a signed event (stored, materialized, fan-out to subscribers)
 * - CLOSE: unsubscribe from a subscription
 *
 * Server responses:
 * - EVENT: push matching event to subscriber
 * - EOSE: end of stored events for a subscription
 * - OK: acknowledgment of a published event
 * - NOTICE: human-readable error/info message
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server as HttpServer } from "node:http";
import { verifyEvent, materializeEvent } from "@boilerdeck/shared";
import type { SignedEvent } from "@boilerdeck/shared";
import { storeEvent, queryEvents } from "./service.js";
import { federateOutbound, isImported } from "./federation.js";
import type {
  EventFilter,
  Subscription,
  ClientMessage,
  RelayEventMessage,
  RelayEoseMessage,
  RelayOkMessage,
  RelayNoticeMessage,
} from "./types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_SUBSCRIPTIONS_PER_CONNECTION = 20;
const MAX_MESSAGE_BYTES = 1 * 1024 * 1024; // 1MB
const MAX_CONTENT_BYTES = 1 * 1024 * 1024; // 1MB
const MAX_TAGS = 1000;
const MAX_SUB_ID_LENGTH = 128;
const MAX_FILTERS_PER_REQ = 10;
const MAX_FILTER_VALUES = 1000;

// ─── Connection State ─────────────────────────────────────────────────────────

interface ConnectionState {
  id: string;
  subscriptions: Map<string, EventFilter[]>;
}

/** All active connections, keyed by connection ID. */
const connections = new Map<string, { ws: WebSocket; state: ConnectionState }>();

let connectionCounter = 0;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Attach the NIP-01 WebSocket relay to an HTTP server.
 * Listens on the `/relay` path.
 */
export function attachRelayWebSocket(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: "/relay",
    maxPayload: MAX_MESSAGE_BYTES,
  });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    const connId = `conn_${++connectionCounter}_${Date.now()}`;
    const state: ConnectionState = {
      id: connId,
      subscriptions: new Map(),
    };
    connections.set(connId, { ws, state });

    ws.on("message", (data) => {
      handleMessage(ws, state, data).catch((err) => {
        console.error(`[relay-ws] Unhandled error for ${connId}:`, err);
      });
    });

    ws.on("close", () => {
      connections.delete(connId);
    });

    ws.on("error", (err) => {
      console.error(`[relay-ws] Connection error ${connId}:`, err.message);
      connections.delete(connId);
    });
  });

  console.log("[relay-ws] WebSocket relay attached on /relay");
  return wss;
}

// ─── Message Handling ─────────────────────────────────────────────────────────

async function handleMessage(
  ws: WebSocket,
  state: ConnectionState,
  raw: unknown,
): Promise<void> {
  let parsed: unknown;
  try {
    const str = typeof raw === "string" ? raw : String(raw);
    parsed = JSON.parse(str);
  } catch {
    sendNotice(ws, "error: invalid JSON");
    return;
  }

  if (!Array.isArray(parsed) || parsed.length < 1) {
    sendNotice(ws, "error: message must be a JSON array");
    return;
  }

  const type = parsed[0];

  switch (type) {
    case "REQ":
      await handleReq(ws, state, parsed as ClientMessage);
      break;
    case "EVENT":
      await handleEvent(ws, state, parsed as ClientMessage);
      break;
    case "CLOSE":
      handleClose(ws, state, parsed as ClientMessage);
      break;
    default:
      sendNotice(ws, "unknown message type");
      break;
  }
}

// ─── REQ ──────────────────────────────────────────────────────────────────────

async function handleReq(
  ws: WebSocket,
  state: ConnectionState,
  msg: ClientMessage,
): Promise<void> {
  // ["REQ", subId, ...filters]
  if (msg.length < 3) {
    sendNotice(ws, "error: REQ requires subscription ID and at least one filter");
    return;
  }

  const subId = msg[1] as string;
  if (typeof subId !== "string" || subId.length === 0 || subId.length > MAX_SUB_ID_LENGTH) {
    sendNotice(ws, "error: invalid subscription ID");
    return;
  }

  // Check subscription limit
  if (
    !state.subscriptions.has(subId) &&
    state.subscriptions.size >= MAX_SUBSCRIPTIONS_PER_CONNECTION
  ) {
    sendNotice(
      ws,
      `error: max subscriptions (${MAX_SUBSCRIPTIONS_PER_CONNECTION}) reached`,
    );
    return;
  }

  const filters: EventFilter[] = [];
  for (let i = 2; i < msg.length && filters.length < MAX_FILTERS_PER_REQ; i++) {
    const f = msg[i];
    if (typeof f === "object" && f !== null && !Array.isArray(f)) {
      filters.push(f as EventFilter);
    }
  }

  if (filters.length === 0) {
    sendNotice(ws, "error: REQ requires at least one filter");
    return;
  }

  // Register subscription (replaces existing with same ID)
  state.subscriptions.set(subId, filters);

  // Replay stored events matching filters
  for (const filter of filters) {
    try {
      const stored = await queryEvents({
        kinds: filter.kinds,
        authors: filter.authors,
        since: filter.since,
        until: filter.until,
        limit: filter.limit,
      });

      // Apply client-side filters the DB doesn't handle (ids, #e, #p)
      for (const event of stored) {
        if (matchesFilter(event, filter)) {
          sendEvent(ws, subId, event);
        }
      }
    } catch (err) {
      console.error("[relay-ws] Error querying stored events:", err);
    }
  }

  // Signal end of stored events
  sendEose(ws, subId);
}

// ─── EVENT ────────────────────────────────────────────────────────────────────

async function handleEvent(
  ws: WebSocket,
  _state: ConnectionState,
  msg: ClientMessage,
): Promise<void> {
  // ["EVENT", signedEvent]
  if (msg.length < 2) {
    sendNotice(ws, "error: EVENT requires a signed event");
    return;
  }

  const event = msg[1] as SignedEvent;

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
    const eventId = event?.id ?? "";
    sendOk(ws, eventId, false, "invalid: malformed event");
    return;
  }

  // Size limits
  if (Buffer.byteLength(event.content, "utf8") > MAX_CONTENT_BYTES) {
    sendOk(ws, event.id, false, "invalid: content exceeds 1MB limit");
    return;
  }
  if (event.tags.length > MAX_TAGS) {
    sendOk(ws, event.id, false, "invalid: tags exceed 1000 limit");
    return;
  }

  // Verify signature
  if (!verifyEvent(event)) {
    sendOk(ws, event.id, false, "invalid: signature verification failed");
    return;
  }

  // Store event
  try {
    const result = await storeEvent(event);

    if (result === "DUPLICATE") {
      sendOk(ws, event.id, true, "duplicate: already have this event");
      return;
    }

    // Materialize into legacy tables (non-fatal)
    try {
      await materializeEvent(event);
    } catch (matErr) {
      console.warn("[relay-ws] materializeEvent failed (non-fatal):", matErr);
    }

    sendOk(ws, event.id, true, "");

    // Fan out to all subscribers with matching filters
    fanOutEvent(event);

    // Forward to external relays (skips imported events)
    federateOutbound(event);
  } catch (err) {
    console.error("[relay-ws] Error storing event:", err);
    sendOk(ws, event.id, false, "error: internal error");
  }
}

// ─── CLOSE ────────────────────────────────────────────────────────────────────

function handleClose(
  _ws: WebSocket,
  state: ConnectionState,
  msg: ClientMessage,
): void {
  // ["CLOSE", subId]
  const subId = msg[1] as string;
  if (typeof subId === "string") {
    state.subscriptions.delete(subId);
  }
}

// ─── Fan-out ──────────────────────────────────────────────────────────────────

/**
 * Push an event to all connections with a subscription that matches it.
 * Exported for use by sign-and-publish and federation modules.
 */
export function fanOutEvent(event: SignedEvent): void {
  for (const [, { ws, state }] of connections) {
    if (ws.readyState !== WebSocket.OPEN) continue;

    for (const [subId, filters] of state.subscriptions) {
      for (const filter of filters) {
        if (matchesFilter(event, filter)) {
          sendEvent(ws, subId, event);
          break; // One match per subscription is enough
        }
      }
    }
  }
}

// ─── Filter Matching ──────────────────────────────────────────────────────────

/**
 * Check if an event matches a NIP-01 filter.
 *
 * All specified filter fields must match (AND logic).
 * Within each field, any value can match (OR logic).
 */
function matchesFilter(event: SignedEvent, filter: EventFilter): boolean {
  // ids
  if (filter.ids && filter.ids.length > 0) {
    if (!filter.ids.some((id) => event.id.startsWith(id))) return false;
  }

  // authors
  if (filter.authors && filter.authors.length > 0) {
    if (!filter.authors.some((a) => event.pubkey.startsWith(a))) return false;
  }

  // kinds
  if (filter.kinds && filter.kinds.length > 0) {
    if (!filter.kinds.includes(event.kind)) return false;
  }

  // since
  if (filter.since !== undefined && event.created_at < filter.since) return false;

  // until
  if (filter.until !== undefined && event.created_at > filter.until) return false;

  // #e tag filter
  const eTags = filter["#e"];
  if (eTags && eTags.length > 0) {
    const eventETags = event.tags
      .filter((t) => t[0] === "e")
      .map((t) => t[1]);
    if (!eTags.some((id) => eventETags.includes(id))) return false;
  }

  // #p tag filter
  const pTags = filter["#p"];
  if (pTags && pTags.length > 0) {
    const eventPTags = event.tags
      .filter((t) => t[0] === "p")
      .map((t) => t[1]);
    if (!pTags.some((pk) => eventPTags.includes(pk))) return false;
  }

  return true;
}

// ─── Send Helpers ─────────────────────────────────────────────────────────────

function send(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendEvent(ws: WebSocket, subId: string, event: SignedEvent): void {
  send(ws, ["EVENT", subId, event] satisfies RelayEventMessage);
}

function sendEose(ws: WebSocket, subId: string): void {
  send(ws, ["EOSE", subId] satisfies RelayEoseMessage);
}

function sendOk(
  ws: WebSocket,
  eventId: string,
  success: boolean,
  message: string,
): void {
  send(ws, ["OK", eventId, success, message] satisfies RelayOkMessage);
}

function sendNotice(ws: WebSocket, message: string): void {
  send(ws, ["NOTICE", message] satisfies RelayNoticeMessage);
}
