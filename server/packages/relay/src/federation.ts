/**
 * External relay federation — outbound and inbound.
 *
 * Outbound: Forwards locally-authored events to configured external relays.
 * Inbound: Subscribes to external relays for events matching local game slugs,
 *          imports them after signature verification.
 * Listing-level: Periodically polls external relays' REST API for listing metadata,
 *                imports into FederatedListing table with signature verification.
 *
 * Loop prevention: Events imported from external relays are NOT re-forwarded.
 * The `importedEventIds` set tracks which events came from federation.
 */

import * as nodeCrypto from "node:crypto";
import WebSocket from "ws";
import { schnorr } from "@noble/curves/secp256k1.js";
import { db, getConfig, verifyEvent } from "@boilerdeck/shared";
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
  /** Listing poll timer handle. */
  pollTimer: ReturnType<typeof setInterval> | null;
}

// ─── State ──────────────────────────────────────────────────────────

const relays = new Map<string, FederatedRelay>();

// ─── Public API ────────────────────────────────────────────────────

/**
 * Initialize federation from the EXTERNAL_RELAYS environment variable.
 * Format: comma-separated WebSocket URLs (wss://relay1.example.com,wss://relay2.example.com)
 *
 * Also upserts each relay URL into the Relay DB table so admin API can manage them,
 * and starts periodic listing polling via REST.
 */
export async function initFederation(): Promise<void> {
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

  // Upsert each relay into the Relay DB table
  for (const url of urls) {
    try {
      await db.relay.upsert({
        where: { url },
        create: { url, name: new URL(url).hostname, status: "active" },
        update: { status: "active" },
      });
    } catch (err) {
      console.error(`[federation] Failed to upsert relay ${url} into DB:`, err);
    }
  }

  console.log(`[federation] Connecting to ${urls.length} external relay(s):`);
  for (const url of urls) {
    console.log(`  - ${url}`);
    addRelay(url);
  }
}

/**
 * Add a relay to the in-memory federation map and start WebSocket + listing polling.
 * No-op if the relay URL is already tracked.
 */
export function addRelay(url: string): void {
  if (relays.has(url)) return;

  const relay: FederatedRelay = {
    url,
    ws: null,
    reconnectTimer: null,
    reconnectAttempts: 0,
    intentionalClose: false,
    subscribed: false,
    pollTimer: null,
  };
  relays.set(url, relay);
  connectToRelay(relay);
  startListingPoll(relay);
}

/**
 * Remove a relay from the in-memory federation map and disconnect.
 */
export function removeRelay(url: string): void {
  const relay = relays.get(url);
  if (!relay) return;

  relay.intentionalClose = true;
  if (relay.reconnectTimer) {
    clearTimeout(relay.reconnectTimer);
    relay.reconnectTimer = null;
  }
  if (relay.pollTimer) {
    clearInterval(relay.pollTimer);
    relay.pollTimer = null;
  }
  if (relay.ws) {
    relay.ws.close();
    relay.ws = null;
  }
  relays.delete(url);
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
    if (relay.pollTimer) {
      clearInterval(relay.pollTimer);
      relay.pollTimer = null;
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

// ─── Listing-Level Federation (REST Polling) ────────────────────────

/**
 * Convert a WebSocket relay URL to an HTTP base URL for REST API calls.
 * wss://example.com/relay -> https://example.com
 * ws://example.com/relay  -> http://example.com
 */
function wsUrlToHttpBase(wsUrl: string): string {
  return wsUrl
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://")
    .replace(/\/relay\/?$/, "");
}

/**
 * Start periodic listing polling for a relay via its REST API.
 */
function startListingPoll(relay: FederatedRelay): void {
  const config = getConfig();
  const intervalMs = config.FEDERATION_POLL_INTERVAL_MS;

  // Do an immediate first poll
  pollRelayListings(relay).catch((err) => {
    console.error(`[federation] Initial listing poll failed for ${relay.url}:`, err);
  });

  // Schedule recurring polls
  relay.pollTimer = setInterval(() => {
    pollRelayListings(relay).catch((err) => {
      console.error(`[federation] Listing poll failed for ${relay.url}:`, err);
    });
  }, intervalMs);

  console.log(`[federation] Listing poll started for ${relay.url} (interval: ${intervalMs}ms)`);
}

/**
 * Poll a relay's REST API for listings and import them into the FederatedListing table.
 */
export async function pollRelayListings(relay: FederatedRelay): Promise<void> {
  const httpBase = wsUrlToHttpBase(relay.url);
  const url = `${httpBase}/api/relay/listings?limit=100`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.warn(`[federation] Failed to fetch listings from ${url}:`, err);
    return;
  }

  if (!response.ok) {
    console.warn(`[federation] Listings endpoint returned ${response.status} from ${url}`);
    return;
  }

  let body: { listings?: unknown[] };
  try {
    body = await response.json() as { listings?: unknown[] };
  } catch {
    console.warn(`[federation] Invalid JSON from listings endpoint ${url}`);
    return;
  }

  if (!body.listings || !Array.isArray(body.listings)) {
    console.warn(`[federation] No listings array in response from ${url}`);
    return;
  }

  let imported = 0;
  for (const raw of body.listings) {
    const listing = raw as Record<string, unknown>;
    if (!listing || typeof listing !== "object") continue;

    const id = String(listing.id ?? "");
    const slug = String(listing.slug ?? "");
    const title = String(listing.title ?? "");
    if (!id || !slug || !title) continue;

    const description = String(listing.description ?? "");
    const priceCents = typeof listing.priceCents === "number" ? listing.priceCents : 0;
    const contentType = String(listing.contentType ?? "GAME");
    const creatorPubkey = listing.creatorPublicKey ? String(listing.creatorPublicKey) : null;
    const signature = listing.signature ? String(listing.signature) : null;
    const coverImageUrl = listing.coverImageUrl ? String(listing.coverImageUrl) : null;

    // Verify Schnorr signature if both creatorPublicKey and signature are present
    if (creatorPubkey && signature) {
      const sigValid = verifyListingSignature({
        title,
        slug,
        description,
        priceCents,
        contentType,
        creatorPublicKey: creatorPubkey,
        signature,
      });
      if (!sigValid) {
        console.warn(`[federation] Rejected listing ${slug} from ${relay.url}: bad signature`);
        continue;
      }
    }

    // Validate contentType
    const validContentTypes = ["GAME", "VIDEO", "SOFTWARE", "AUDIO", "OTHER"];
    const safeContentType = validContentTypes.includes(contentType) ? contentType : "GAME";

    try {
      await db.federatedListing.upsert({
        where: {
          relayUrl_remoteId: { relayUrl: relay.url, remoteId: id },
        },
        create: {
          relayUrl: relay.url,
          remoteId: id,
          slug,
          title,
          description,
          creatorPubkey,
          signature,
          contentType: safeContentType as "GAME" | "VIDEO" | "SOFTWARE" | "AUDIO" | "OTHER",
          priceCents,
          coverImageUrl,
        },
        update: {
          slug,
          title,
          description,
          creatorPubkey,
          signature,
          contentType: safeContentType as "GAME" | "VIDEO" | "SOFTWARE" | "AUDIO" | "OTHER",
          priceCents,
          coverImageUrl,
        },
      });
      imported++;
    } catch (err) {
      console.error(`[federation] Error upserting federated listing ${slug}:`, err);
    }
  }

  // Update relay status in DB
  await updateRelayStatus(relay.url, "active");

  if (imported > 0) {
    console.log(`[federation] Imported ${imported} listing(s) from ${relay.url}`);
  }
}

/**
 * Verify a Schnorr signature on listing data.
 * Canonical format: JSON.stringify({ title, slug, description, priceCents, contentType })
 */
function verifyListingSignature(data: {
  title: string;
  slug: string;
  description: string;
  priceCents: number;
  contentType: string;
  creatorPublicKey: string;
  signature: string;
}): boolean {
  try {
    const canonicalData = JSON.stringify({
      title: data.title,
      slug: data.slug,
      description: data.description,
      priceCents: data.priceCents,
      contentType: data.contentType,
    });
    const messageHash = Buffer.from(
      nodeCrypto.createHash("sha256").update(canonicalData).digest(),
    );
    const sigBytes = Buffer.from(data.signature, "hex");
    const pubkeyBytes = Buffer.from(data.creatorPublicKey, "hex");
    return schnorr.verify(sigBytes, messageHash, pubkeyBytes);
  } catch {
    return false;
  }
}

/**
 * Update a relay's lastSyncAt and status in the DB.
 */
export async function updateRelayStatus(url: string, status: string): Promise<void> {
  try {
    await db.relay.update({
      where: { url },
      data: { lastSyncAt: new Date(), status },
    });
  } catch {
    // Relay may not exist in DB yet (e.g., added via admin API after init)
    // Silently ignore — not critical
  }
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
    await fanOutEvent(event);
  } catch (err) {
    console.error(`[federation] Error storing inbound event:`, err);
  }
}
