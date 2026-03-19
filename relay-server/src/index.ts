/**
 * BoilerDeck Relay Server — Standalone
 *
 * A minimal, self-contained relay for the BoilerDeck content federation network.
 * Supports NIP-01 WebSocket protocol and REST listing management.
 *
 * No auth, no payment, no license code — listing metadata + events only.
 */

import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { PrismaClient, type ContentType } from "@prisma/client";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SignedEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

interface EventFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  "#e"?: string[];
  "#p"?: string[];
}

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const RELAY_NAME = process.env.RELAY_NAME ?? "BoilerDeck Relay";
const RELAY_DESCRIPTION =
  process.env.RELAY_DESCRIPTION ?? "A BoilerDeck federation relay";

// ─── Database ────────────────────────────────────────────────────────────────

const db = new PrismaClient();

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Relay info (NIP-11 style)
app.get("/relay/info", (_req, res) => {
  res.json({
    name: RELAY_NAME,
    description: RELAY_DESCRIPTION,
    version: "1.0.0",
    supported_nips: [1],
    software: "boilerdeck-relay",
  });
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Listings REST API ───────────────────────────────────────────────────────

// GET /api/relay/listings — paginated, with optional ?contentType filter
app.get("/api/relay/listings", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit as string, 10) || 20),
    );
    const offset = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (req.query.contentType) {
      where.contentType = req.query.contentType as string;
    }

    const [listings, total] = await Promise.all([
      db.federatedListing.findMany({
        where,
        orderBy: { importedAt: "desc" },
        skip: offset,
        take: limit,
      }),
      db.federatedListing.count({ where }),
    ]);

    res.json({ listings, total, page, limit });
  } catch (err) {
    next(err);
  }
});

// GET /api/relay/listings/:id — single listing
app.get("/api/relay/listings/:id", async (req, res, next) => {
  try {
    const listing = await db.federatedListing.findUnique({
      where: { id: req.params.id },
    });
    if (!listing) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Listing not found" } });
      return;
    }
    res.json(listing);
  } catch (err) {
    next(err);
  }
});

// POST /api/relay/listings — accept signed listing
app.post("/api/relay/listings", async (req, res, next) => {
  try {
    const {
      relayUrl,
      remoteId,
      slug,
      title,
      description,
      creatorPubkey,
      signature,
      contentType,
      metadata,
      priceCents,
      coverImageUrl,
    } = req.body;

    // Validate required fields
    if (!relayUrl || !remoteId || !slug || !title) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "relayUrl, remoteId, slug, and title are required",
        },
      });
      return;
    }

    // Verify Schnorr signature if provided
    if (creatorPubkey && signature) {
      const payload = JSON.stringify({ relayUrl, remoteId, slug, title });
      const payloadBytes = new TextEncoder().encode(payload);
      const hash = sha256(payloadBytes);
      const sigBytes = hexToBytes(signature);
      const pubkeyBytes = hexToBytes(creatorPubkey);

      const valid = schnorr.verify(sigBytes, hash, pubkeyBytes);
      if (!valid) {
        res.status(400).json({
          error: {
            code: "INVALID_SIGNATURE",
            message: "Schnorr signature verification failed",
          },
        });
        return;
      }
    }

    // Upsert listing
    const listing = await db.federatedListing.upsert({
      where: {
        relayUrl_remoteId: { relayUrl, remoteId },
      },
      update: {
        slug,
        title,
        description: description ?? "",
        creatorPubkey,
        signature,
        contentType: contentType ?? "GAME",
        metadata: metadata ?? {},
        priceCents: priceCents ?? 0,
        coverImageUrl,
      },
      create: {
        relayUrl,
        remoteId,
        slug,
        title,
        description: description ?? "",
        creatorPubkey,
        signature,
        contentType: contentType ?? "GAME",
        metadata: metadata ?? {},
        priceCents: priceCents ?? 0,
        coverImageUrl,
      },
    });

    res.status(201).json(listing);
  } catch (err) {
    next(err);
  }
});

// ─── Error Handler ───────────────────────────────────────────────────────────

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[relay] Error:", err.message);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  },
);

// ─── HTTP Server + WebSocket ─────────────────────────────────────────────────

const server = createServer(app);

// ─── NIP-01 WebSocket Relay ──────────────────────────────────────────────────

const MAX_SUBSCRIPTIONS = 20;
const MAX_MESSAGE_BYTES = 1 * 1024 * 1024;
const MAX_CONTENT_BYTES = 1 * 1024 * 1024;
const MAX_TAGS = 1000;
const MAX_SUB_ID_LENGTH = 128;
const MAX_FILTERS_PER_REQ = 10;

interface ConnectionState {
  id: string;
  subscriptions: Map<string, EventFilter[]>;
}

const connections = new Map<
  string,
  { ws: WebSocket; state: ConnectionState }
>();
let connectionCounter = 0;

const wss = new WebSocketServer({
  server,
  path: "/relay",
  maxPayload: MAX_MESSAGE_BYTES,
});

wss.on("connection", (ws) => {
  const connId = `conn_${++connectionCounter}_${Date.now()}`;
  const state: ConnectionState = { id: connId, subscriptions: new Map() };
  connections.set(connId, { ws, state });

  ws.on("message", (data) => {
    handleMessage(ws, state, data).catch((err) => {
      console.error(`[relay-ws] Error for ${connId}:`, err);
    });
  });

  ws.on("close", () => connections.delete(connId));
  ws.on("error", (err) => {
    console.error(`[relay-ws] Error ${connId}:`, err.message);
    connections.delete(connId);
  });
});

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

  switch (parsed[0]) {
    case "REQ":
      await handleReq(ws, state, parsed);
      break;
    case "EVENT":
      await handleEvent(ws, parsed);
      break;
    case "CLOSE":
      handleClose(state, parsed);
      break;
    default:
      sendNotice(ws, "unknown message type");
  }
}

// ─── REQ ─────────────────────────────────────────────────────────────────────

async function handleReq(
  ws: WebSocket,
  state: ConnectionState,
  msg: unknown[],
): Promise<void> {
  if (msg.length < 3) {
    sendNotice(ws, "error: REQ requires subscription ID and at least one filter");
    return;
  }

  const subId = msg[1] as string;
  if (
    typeof subId !== "string" ||
    subId.length === 0 ||
    subId.length > MAX_SUB_ID_LENGTH
  ) {
    sendNotice(ws, "error: invalid subscription ID");
    return;
  }

  if (
    !state.subscriptions.has(subId) &&
    state.subscriptions.size >= MAX_SUBSCRIPTIONS
  ) {
    sendNotice(ws, `error: max subscriptions (${MAX_SUBSCRIPTIONS}) reached`);
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

  state.subscriptions.set(subId, filters);

  // Replay stored events matching filters
  for (const filter of filters) {
    try {
      const stored = await queryEvents(filter);
      for (const event of stored) {
        if (matchesFilter(event, filter)) {
          send(ws, ["EVENT", subId, event]);
        }
      }
    } catch (err) {
      console.error("[relay-ws] Error querying stored events:", err);
    }
  }

  send(ws, ["EOSE", subId]);
}

// ─── EVENT ───────────────────────────────────────────────────────────────────

async function handleEvent(ws: WebSocket, msg: unknown[]): Promise<void> {
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
    send(ws, ["OK", event?.id ?? "", false, "invalid: malformed event"]);
    return;
  }

  // Size limits
  if (new TextEncoder().encode(event.content).length > MAX_CONTENT_BYTES) {
    send(ws, ["OK", event.id, false, "invalid: content exceeds 1MB limit"]);
    return;
  }
  if (event.tags.length > MAX_TAGS) {
    send(ws, ["OK", event.id, false, "invalid: tags exceed 1000 limit"]);
    return;
  }

  // Verify signature
  if (!verifyEvent(event)) {
    send(ws, ["OK", event.id, false, "invalid: signature verification failed"]);
    return;
  }

  // Store event
  try {
    const result = await storeEvent(event);

    if (result === "DUPLICATE") {
      send(ws, ["OK", event.id, true, "duplicate: already have this event"]);
      return;
    }

    send(ws, ["OK", event.id, true, ""]);

    // Fan out to all subscribers with matching filters
    fanOutEvent(event);
  } catch (err) {
    console.error("[relay-ws] Error storing event:", err);
    send(ws, ["OK", event.id, false, "error: internal error"]);
  }
}

// ─── CLOSE ───────────────────────────────────────────────────────────────────

function handleClose(state: ConnectionState, msg: unknown[]): void {
  const subId = msg[1] as string;
  if (typeof subId === "string") {
    state.subscriptions.delete(subId);
  }
}

// ─── Event Verification ──────────────────────────────────────────────────────

function serializeEvent(event: SignedEvent): string {
  return JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
}

function hashEvent(event: SignedEvent): string {
  const serialized = serializeEvent(event);
  const bytes = new TextEncoder().encode(serialized);
  const hash = sha256(bytes);
  return bytesToHex(hash);
}

function verifyEvent(event: SignedEvent): boolean {
  try {
    // Validate field formats
    if (event.id.length !== 64 || !/^[0-9a-f]+$/i.test(event.id)) return false;
    if (event.pubkey.length !== 64 || !/^[0-9a-f]+$/i.test(event.pubkey))
      return false;
    if (event.sig.length !== 128 || !/^[0-9a-f]+$/i.test(event.sig))
      return false;

    // Recompute hash and verify id matches
    const expectedId = hashEvent(event);
    if (event.id !== expectedId) return false;

    // Verify Schnorr signature
    const idBytes = hexToBytes(event.id);
    const sigBytes = hexToBytes(event.sig);
    const pubkeyBytes = hexToBytes(event.pubkey);

    return schnorr.verify(sigBytes, idBytes, pubkeyBytes);
  } catch {
    return false;
  }
}

// ─── Event Storage ───────────────────────────────────────────────────────────

async function storeEvent(
  event: SignedEvent,
): Promise<"STORED" | "DUPLICATE"> {
  // Extract d tag for parameterized replaceable events
  let dTag: string | null = null;
  for (const tag of event.tags) {
    if (tag[0] === "d") {
      dTag = tag[1] ?? "";
      break;
    }
  }

  try {
    await db.event.upsert({
      where: {
        pubkey_kind_dTag: {
          pubkey: event.pubkey,
          kind: event.kind,
          dTag: dTag ?? event.id, // Use event ID as dTag for non-replaceable events
        },
      },
      update: {
        id: event.id,
        createdAt: event.created_at,
        tags: event.tags as unknown as string,
        content: event.content,
        sig: event.sig,
        dTag,
      },
      create: {
        id: event.id,
        pubkey: event.pubkey,
        createdAt: event.created_at,
        kind: event.kind,
        tags: event.tags as unknown as string,
        content: event.content,
        sig: event.sig,
        dTag,
      },
    });
    return "STORED";
  } catch (err: unknown) {
    // Duplicate ID
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return "DUPLICATE";
    }
    throw err;
  }
}

async function queryEvents(filter: EventFilter): Promise<SignedEvent[]> {
  const where: Record<string, unknown> = {};

  if (filter.kinds && filter.kinds.length > 0) {
    where.kind = { in: filter.kinds };
  }
  if (filter.authors && filter.authors.length > 0) {
    where.pubkey = { in: filter.authors };
  }
  if (filter.since !== undefined) {
    where.createdAt = { ...(where.createdAt as object), gte: filter.since };
  }
  if (filter.until !== undefined) {
    where.createdAt = { ...(where.createdAt as object), lte: filter.until };
  }

  const events = await db.event.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(filter.limit ?? 500, 1000),
  });

  return events.map((e) => ({
    id: e.id,
    pubkey: e.pubkey,
    created_at: e.createdAt,
    kind: e.kind,
    tags: e.tags as unknown as string[][],
    content: e.content,
    sig: e.sig,
  }));
}

// ─── Fan-out ─────────────────────────────────────────────────────────────────

function fanOutEvent(event: SignedEvent): void {
  for (const [, { ws, state }] of connections) {
    if (ws.readyState !== WebSocket.OPEN) continue;

    for (const [subId, filters] of state.subscriptions) {
      for (const filter of filters) {
        if (matchesFilter(event, filter)) {
          send(ws, ["EVENT", subId, event]);
          break;
        }
      }
    }
  }
}

// ─── Filter Matching ─────────────────────────────────────────────────────────

function matchesFilter(event: SignedEvent, filter: EventFilter): boolean {
  if (filter.ids && filter.ids.length > 0) {
    if (!filter.ids.some((id) => event.id.startsWith(id))) return false;
  }
  if (filter.authors && filter.authors.length > 0) {
    if (!filter.authors.some((a) => event.pubkey.startsWith(a))) return false;
  }
  if (filter.kinds && filter.kinds.length > 0) {
    if (!filter.kinds.includes(event.kind)) return false;
  }
  if (filter.since !== undefined && event.created_at < filter.since)
    return false;
  if (filter.until !== undefined && event.created_at > filter.until)
    return false;

  const eTags = filter["#e"];
  if (eTags && eTags.length > 0) {
    const eventETags = event.tags
      .filter((t) => t[0] === "e")
      .map((t) => t[1]);
    if (!eTags.some((id) => eventETags.includes(id))) return false;
  }

  const pTags = filter["#p"];
  if (pTags && pTags.length > 0) {
    const eventPTags = event.tags
      .filter((t) => t[0] === "p")
      .map((t) => t[1]);
    if (!pTags.some((pk) => eventPTags.includes(pk))) return false;
  }

  return true;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function send(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendNotice(ws: WebSocket, message: string): void {
  send(ws, ["NOTICE", message]);
}

// ─── Start ───────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[boilerdeck-relay] Listening on port ${PORT}`);
  console.log(`[boilerdeck-relay] REST API: http://localhost:${PORT}/api/relay/listings`);
  console.log(`[boilerdeck-relay] WebSocket: ws://localhost:${PORT}/relay`);
  console.log(`[boilerdeck-relay] Info: http://localhost:${PORT}/relay/info`);
});
