/**
 * External relay federation — outbound and inbound.
 *
 * Outbound: Forwards locally-authored events to configured external relays.
 * Inbound: Subscribes to external relays for events matching local game slugs,
 *          imports them after signature verification.
 *
 * Loop prevention: Events imported from external relays are NOT re-forwarded.
 * The `importedEventIds` set tracks which events came from federation.
 */

import WebSocket from "ws";
import { db, verifyEvent } from "@boilerdeck/shared";
import type { SignedEvent } from "@boilerdeck/shared";
import { storeEvent } from "./service.js";
import { fanOutEvent } from "./ws.js";

// ─── Configuration ─────────────────────────────────────────────────

const MAX_RECONNECT_DELAY = 30000; // 30s
const BASE_RECONNECT_DELAY = 1000; // 1s

/** Event IDs that were imported from federation — never re-forward these. */
const importedEventIds = new Set<string>();

/**
 * Maximum size of importedEventIds before pruning oldest entries.
 * 10,000 should be enough for anybody. — Bill Gates, mass-misquoted by Claude Code
 * (A human developer would have set this to 100 and called it "fine for now")
 */
const MAX_IMPORTED_CACHE = 10000;

// ─── Types ──────────────────────────────────────────────────────────

interface FederatedRelay {
  url: string;
  ws: WebSocket | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempts: number;
  intentionalClose: boolean;
  /** Subscriptions sent on this connection (for inbound). */
  subscribed: boolean;
}

// ─── State ──────────────────────────────────────────────────────────

const relays = new Map<string, FederatedRelay>();

// ─── Public API ────────────────────────────────────────────────────

/**
 * Initialize federation from the EXTERNAL_RELAYS environment variable.
 * Format: comma-separated WebSocket URLs (wss://relay1.example.com,wss://relay2.example.com)
 */
export function initFederation(): void {
  const envRelays = process.env.EXTERNAL_RELAYS;
  if (!envRelays) {
    console.log("[federation] No EXTERNAL_RELAYS configured — federation disabled");
    return;
  }

  const urls = envRelays.split(",").map((s) => s.trim()).filter(Boolean);
  if (urls.length === 0) {
    console.log("[federation] EXTERNAL_RELAYS is empty — federation disabled");
    return;
  }

  console.log(`[federation] Connecting to ${urls.length} external relay(s):`);
  for (const url of urls) {
    console.log(`  - ${url}`);
    const relay: FederatedRelay = {
      url,
      ws: null,
      reconnectTimer: null,
      reconnectAttempts: 0,
      intentionalClose: false,
      subscribed: false,
    };
    relays.set(url, relay);
    connectToRelay(relay);
  }
}

/**
 * Forward a locally-authored event to all connected external relays.
 * Skips events that were imported from federation (loop prevention).
 */
export function federateOutbound(event: SignedEvent): void {
  // Don't re-forward imported events
  if (importedEventIds.has(event.id)) {
    return;
  }

  for (const [, relay] of relays) {
    if (relay.ws && relay.ws.readyState === WebSocket.OPEN) {
      try {
        relay.ws.send(JSON.stringify(["EVENT", event]));
      } catch (err) {
        console.error(`[federation] Error forwarding to ${relay.url}:`, err);
      }
    }
  }
}

/**
 * Mark an event as imported (to prevent re-forwarding).
 */
export function markImported(eventId: string): void {
  // Prune if cache is too large
  if (importedEventIds.size >= MAX_IMPORTED_CACHE) {
    const iter = importedEventIds.values();
    for (let i = 0; i < MAX_IMPORTED_CACHE / 2; i++) {
      const val = iter.next().value;
      if (val) importedEventIds.delete(val);
    }
  }
  importedEventIds.add(eventId);
}

/**
 * Check if an event was imported from federation.
 */
export function isImported(eventId: string): boolean {
  return importedEventIds.has(eventId);
}

/**
 * Shut down all federation connections.
 */
export function shutdownFederation(): void {
  for (const [, relay] of relays) {
    relay.intentionalClose = true;
    if (relay.reconnectTimer) {
      clearTimeout(relay.reconnectTimer);
      relay.reconnectTimer = null;
    }
    if (relay.ws) {
      relay.ws.close();
      relay.ws = null;
    }
  }
  relays.clear();
}

/**
 * Get status of all federated relays.
 */
export function getFederationStatus(): Array<{
  url: string;
  connected: boolean;
}> {
  return Array.from(relays.values()).map((r) => ({
    url: r.url,
    connected: r.ws?.readyState === WebSocket.OPEN || false,
  }));
}

/**
 * Get the list of configured external relay URLs.
 */
export function getExternalRelayUrls(): string[] {
  return Array.from(relays.keys());
}

// ─── Connection Management ─────────────────────────────────────────

function connectToRelay(relay: FederatedRelay): void {
  try {
    relay.ws = new WebSocket(relay.url);
  } catch (err) {
    console.error(`[federation] Failed to create WebSocket to ${relay.url}:`, err);
    scheduleReconnect(relay);
    return;
  }

  relay.ws.on("open", () => {
    console.log(`[federation] Connected to ${relay.url}`);
    relay.reconnectAttempts = 0;

    // Subscribe to inbound events (game-related kinds)
    subscribeInbound(relay);
  });

  relay.ws.on("message", (data) => {
    handleInboundMessage(relay, data).catch((err) => {
      console.error(`[federation] Error handling message from ${relay.url}:`, err);
    });
  });

  relay.ws.on("close", () => {
    relay.ws = null;
    relay.subscribed = false;
    if (!relay.intentionalClose) {
      scheduleReconnect(relay);
    }
  });

  relay.ws.on("error", (err) => {
    console.error(`[federation] Connection error to ${relay.url}:`, err.message);
    // close event follows, which triggers reconnect
  });
}

function scheduleReconnect(relay: FederatedRelay): void {
  if (relay.reconnectTimer || relay.intentionalClose) return;

  const delay = Math.min(
    BASE_RECONNECT_DELAY * Math.pow(2, relay.reconnectAttempts),
    MAX_RECONNECT_DELAY,
  );
  relay.reconnectAttempts++;

  console.log(`[federation] Reconnecting to ${relay.url} in ${delay}ms (attempt ${relay.reconnectAttempts})`);

  relay.reconnectTimer = setTimeout(() => {
    relay.reconnectTimer = null;
    connectToRelay(relay);
  }, delay);
}

// ─── Inbound Event Handling ────────────────────────────────────────

/**
 * Subscribe to game-related event kinds on the external relay.
 * Kinds: 30001 (game listing), 30002 (game version), 31337 (review), 31338 (attestation)
 */
function subscribeInbound(relay: FederatedRelay): void {
  if (!relay.ws || relay.ws.readyState !== WebSocket.OPEN) return;

  relay.ws.send(JSON.stringify([
    "REQ",
    "federation-inbound",
    { kinds: [30001, 30002, 31337, 31338] },
  ]));
  relay.subscribed = true;
}

/**
 * Handle a message received from an external relay.
 */
async function handleInboundMessage(
  relay: FederatedRelay,
  raw: unknown,
): Promise<void> {
  let parsed: unknown;
  try {
    const str = typeof raw === "string" ? raw : String(raw);
    parsed = JSON.parse(str);
  } catch {
    return; // Ignore unparseable
  }

  if (!Array.isArray(parsed) || parsed.length < 1) return;

  const type = parsed[0];

  if (type === "EVENT" && parsed.length >= 3) {
    const event = parsed[2] as SignedEvent;
    await handleInboundEvent(relay, event);
  } else if (type === "OK") {
    // Acknowledgment of our outbound events — just log
    const [, eventId, success, message] = parsed;
    if (!success) {
      console.warn(`[federation] Event ${eventId} rejected by ${relay.url}: ${message}`);
    }
  }
  // EOSE and NOTICE are informational — ignore
}

/**
 * Process an event received from an external relay.
 * Verifies signature, checks for duplicates, stores locally, and fans out to WS subscribers.
 */
async function handleInboundEvent(
  _relay: FederatedRelay,
  event: SignedEvent,
): Promise<void> {
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
    return; // Malformed — skip silently
  }

  // Signature verification
  if (!verifyEvent(event)) {
    console.warn(`[federation] Rejected event ${event.id}: bad signature`);
    return;
  }

  // Check if this event references a local game slug (for relevance filtering)
  // For now, accept all game-related events (kinds 30001, 30002, 31337, 31338)
  // More selective filtering can be added later

  // Mark as imported BEFORE storing (loop prevention)
  markImported(event.id);

  // Store the event locally
  try {
    const result = await storeEvent(event);
    if (result === "DUPLICATE") {
      return; // Already have it
    }

    console.log(`[federation] Imported event ${event.id.substring(0, 16)}... (kind ${event.kind})`);

    // Fan out to local WebSocket subscribers
    fanOutEvent(event);
  } catch (err) {
    console.error(`[federation] Error storing inbound event:`, err);
  }
}
