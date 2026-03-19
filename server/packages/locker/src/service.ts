/**
 * Locker business logic — upload, list, delete, and torrent retrieval.
 *
 * Orchestrates file storage, torrent creation, NIP-44 encryption,
 * Nostr event signing, and relay publishing for the data locker.
 */

import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import mime from "mime-types";
import {
  db,
  redis,
  getConfig,
  storeEvent,
  queryEvents,
  createEvent,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  type SignedEvent,
} from "@boilerdeck/shared";
import {
  LOCKER_ENTRY_KIND,
  serializeLockerEntry,
  deserializeLockerEntry,
  buildLockerEventTags,
  type LockerEntry,
} from "@boilerdeck/shared";
import { signEventForUser } from "@boilerdeck/auth";
import { nip44Encrypt, nip44Decrypt } from "@boilerdeck/auth";
import { createTorrent } from "@boilerdeck/torrent";
import * as storage from "./storage.js";

// ─── Types ──────────────────────────────────────────────────────────

export interface UploadResult {
  entryId: string;
  infoHash: string;
  eventId: string;
}

export interface ListResult {
  entries: LockerEntry[];
  quota: {
    used: number;  // bytes
    max: number;   // bytes
  };
}

export interface DeleteResult {
  success: true;
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Get a user's private key hex from Redis cache for NIP-44 operations.
 * Same pattern as signing.ts — decrypts the cached signing key.
 */
async function getUserPrivkeyHex(userId: string): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { nostrPubkey: true, custodyMode: true },
  });

  if (!user || !user.nostrPubkey) {
    throw new UnauthorizedError(
      "User has no cryptographic identity. Register or log in to generate a keypair.",
    );
  }

  if (user.custodyMode === "SELF_CUSTODY") {
    throw new UnauthorizedError(
      "Self-custody users must manage locker entries client-side.",
    );
  }

  const cached = await redis.get(`signing_key:${userId}`);
  if (!cached) {
    throw new UnauthorizedError(
      "Signing key not cached. Your session may have expired — please log in again.",
    );
  }

  // Decrypt the cached key (same format as signing.ts)
  const parts = cached.split(":");
  if (parts.length !== 3) {
    throw new UnauthorizedError("Invalid signing key cache format.");
  }

  const nonce = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const ciphertext = Buffer.from(parts[2], "hex");
  const key = Buffer.from(getConfig().SIGNING_CACHE_KEY, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  const privkeyBytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return privkeyBytes.toString("hex");
}

/**
 * Get user's nostr pubkey.
 */
async function getUserPubkey(userId: string): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { nostrPubkey: true },
  });

  if (!user?.nostrPubkey) {
    throw new UnauthorizedError("User has no cryptographic identity.");
  }

  return user.nostrPubkey;
}

/**
 * Add a torrent to Transmission RPC for VPS seeding.
 * Non-blocking — failure is logged but not fatal.
 */
async function addToTransmission(torrentBuffer: Buffer, downloadDir: string): Promise<void> {
  const rpcUrl = getConfig().TRANSMISSION_RPC_URL;
  const body = JSON.stringify({
    method: "torrent-add",
    arguments: {
      "metainfo": torrentBuffer.toString("base64"),
      "download-dir": downloadDir,
    },
  });

  console.log(`[locker:transmission] Adding torrent to ${rpcUrl}, download-dir: ${downloadDir}`);

  // First attempt — will get 409 with session ID
  const first = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  let response: Response;

  if (first.status === 409) {
    const sessionId = first.headers.get("X-Transmission-Session-Id") ?? "";
    if (!sessionId) throw new Error("Transmission returned 409 but no session ID");

    response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Transmission-Session-Id": sessionId,
      },
      body,
    });
  } else {
    response = first;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Transmission RPC HTTP ${response.status}: ${text}`);
  }

  const result = await response.json() as { result: string; arguments?: Record<string, unknown> };
  if (result.result !== "success") {
    throw new Error(`Transmission RPC failed: ${result.result}`);
  }

  console.log("[locker:transmission] Torrent added successfully:", JSON.stringify(result.arguments));
}

/**
 * Remove a torrent from Transmission by info hash.
 * Non-fatal — logs errors but doesn't throw.
 */
async function removeFromTransmission(infoHash: string): Promise<void> {
  const rpcUrl = getConfig().TRANSMISSION_RPC_URL;

  // First, get the torrent ID by info hash
  const getBody = JSON.stringify({
    method: "torrent-get",
    arguments: {
      fields: ["id", "hashString"],
    },
  });

  const first = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: getBody,
  });

  let sessionId = "";
  let response: Response;

  if (first.status === 409) {
    sessionId = first.headers.get("X-Transmission-Session-Id") ?? "";
    if (!sessionId) return;

    response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Transmission-Session-Id": sessionId,
      },
      body: getBody,
    });
  } else {
    response = first;
  }

  if (!response.ok) return;

  const getResult = await response.json() as {
    result: string;
    arguments?: { torrents?: Array<{ id: number; hashString: string }> };
  };

  if (getResult.result !== "success") return;

  const torrent = getResult.arguments?.torrents?.find(
    (t) => t.hashString.toLowerCase() === infoHash.toLowerCase(),
  );

  if (!torrent) return;

  // Remove the torrent (but keep data — cleanup handles actual file deletion)
  const removeBody = JSON.stringify({
    method: "torrent-remove",
    arguments: {
      ids: [torrent.id],
      "delete-local-data": false,
    },
  });

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sessionId) headers["X-Transmission-Session-Id"] = sessionId;

  await fetch(rpcUrl, { method: "POST", headers, body: removeBody });
  console.log(`[locker:transmission] Removed torrent ${infoHash}`);
}

// ─── Upload ─────────────────────────────────────────────────────────

/**
 * Process an uploaded file for the data locker.
 *
 * 1. Save file to LOCKER_DIR/<userId>/<entryId>/
 * 2. Compute SHA-256 hash
 * 3. Detect MIME type
 * 4. Create torrent
 * 5. Send to Transmission for VPS seeding
 * 6. Build LockerEntry
 * 7. Encrypt with NIP-44 (to user's own pubkey)
 * 8. Sign & publish Nostr event (kind 30078)
 * 9. Return { entryId, infoHash, eventId }
 */
export async function uploadFile(
  userId: string,
  tempFilePath: string,
  originalFilename: string,
  fileSize: number,
  userTags: string[] = [],
): Promise<UploadResult> {
  const entryId = uuidv4();

  // Check quota (DB-based)
  const fileSizeBig = BigInt(fileSize);
  const quota = await storage.getQuota(userId);
  if (quota.used + fileSizeBig > quota.max) {
    const usedMB = Number(quota.used / BigInt(1024 * 1024));
    const maxGB = Number(quota.max / BigInt(1024 * 1024 * 1024));
    const fileMB = Math.round(fileSize / (1024 * 1024));
    throw new ForbiddenError(
      `Storage quota exceeded. Used: ${usedMB} MB, ` +
      `Max: ${maxGB} GB, File: ${fileMB} MB`,
    );
  }

  // 1. Save file to entry directory
  const filePath = await storage.saveFile(tempFilePath, userId, entryId, originalFilename);

  // 2. Compute SHA-256
  const sha256 = await storage.computeFileHash(filePath);

  // 3. Detect MIME type
  const mimeType = mime.lookup(originalFilename) || "application/octet-stream";

  // 4. Create torrent for the entry directory
  const entryDir = storage.getEntryDir(userId, entryId);
  const { torrentBuffer, infoHash, magnetUri } = await createTorrent(entryDir, entryId);

  // 5. Save .torrent file
  const torrentPath = await storage.saveTorrentFile(userId, entryId, torrentBuffer);

  // 6. Send to Transmission (non-blocking, non-fatal)
  addToTransmission(torrentBuffer, storage.getUserDir(userId)).catch((err) => {
    console.warn("[locker] Failed to add torrent to Transmission:", err);
  });

  // 7. Build LockerEntry
  const lockerEntry: LockerEntry = {
    id: entryId,
    filename: originalFilename,
    size: fileSize,
    mimeType,
    sha256,
    infoHash,
    magnetUri,
    createdAt: Math.floor(Date.now() / 1000),
    tags: userTags,
    version: 1,
  };

  // 8. Encrypt with NIP-44 to user's own pubkey
  const pubkey = await getUserPubkey(userId);
  const privkeyHex = await getUserPrivkeyHex(userId);
  const plaintext = serializeLockerEntry(lockerEntry);
  const encrypted = nip44Encrypt(plaintext, privkeyHex, pubkey);

  // 9. Sign & publish Nostr event (kind 30078)
  const tags = buildLockerEventTags(lockerEntry);
  const event = await signEventForUser(userId, {
    kind: LOCKER_ENTRY_KIND,
    tags,
    content: encrypted,
  });

  // Store the event
  await storeEvent(event);

  // 10. Create LockerFile record and update quota in DB
  await db.lockerFile.create({
    data: {
      userId,
      entryId,
      filename: originalFilename,
      size: fileSizeBig,
      infoHash,
      torrentPath,
      filePath,
    },
  });
  await storage.incrementQuota(userId, fileSizeBig);

  return {
    entryId,
    infoHash,
    eventId: event.id,
  };
}

// ─── List ───────────────────────────────────────────────────────────

/**
 * List all locker entries for a user.
 *
 * Queries the event store for kind 30078 events by the user's pubkey,
 * then decrypts each entry server-side (custodial users only).
 */
export async function listEntries(userId: string): Promise<ListResult> {
  const pubkey = await getUserPubkey(userId);
  const privkeyHex = await getUserPrivkeyHex(userId);

  // Query for user's locker events
  const events = await queryEvents({
    kinds: [LOCKER_ENTRY_KIND],
    authors: [pubkey],
    limit: 500,
  });

  // Decrypt each entry
  const entries: LockerEntry[] = [];
  for (const event of events) {
    try {
      const plaintext = nip44Decrypt(event.content, privkeyHex, pubkey);
      const entry = deserializeLockerEntry(plaintext);
      entries.push(entry);
    } catch (err) {
      // Skip entries that fail to decrypt (may be from a different key epoch)
      console.warn(`[locker] Failed to decrypt entry from event ${event.id}:`, err);
    }
  }

  // Compute quota (DB-based)
  const quota = await storage.getQuota(userId);

  return {
    entries,
    quota: {
      used: Number(quota.used),
      max: Number(quota.max),
    },
  };
}

// ─── Delete ─────────────────────────────────────────────────────────

/**
 * Delete a locker entry.
 *
 * 1. Find the event by querying for the user's kind 30078 with matching d-tag
 * 2. Publish a kind 5 (NIP-09) deletion event
 * 3. Remove torrent from Transmission
 * 4. Mark files for cleanup
 */
export async function deleteEntry(
  userId: string,
  entryId: string,
): Promise<DeleteResult> {
  const pubkey = await getUserPubkey(userId);

  // Find the locker event for this entry
  const events = await queryEvents({
    kinds: [LOCKER_ENTRY_KIND],
    authors: [pubkey],
    limit: 500,
  });

  // Find the event with matching d-tag (entryId)
  const targetEvent = events.find((event) =>
    event.tags.some((tag) => tag[0] === "d" && tag[1] === entryId),
  );

  if (!targetEvent) {
    throw new NotFoundError("Locker entry");
  }

  // Try to decrypt to get infoHash for Transmission removal
  let infoHash: string | null = null;
  try {
    const privkeyHex = await getUserPrivkeyHex(userId);
    const plaintext = nip44Decrypt(targetEvent.content, privkeyHex, pubkey);
    const entry = deserializeLockerEntry(plaintext);
    infoHash = entry.infoHash;
  } catch {
    // Non-fatal — we can still delete the event without removing from Transmission
  }

  // Publish a kind 5 (NIP-09) deletion event referencing the locker entry
  const deletionEvent = await signEventForUser(userId, {
    kind: 5,
    tags: [["e", targetEvent.id]],
    content: "Locker entry deleted",
  });

  await storeEvent(deletionEvent);

  // Remove torrent from Transmission (non-fatal)
  if (infoHash) {
    removeFromTransmission(infoHash).catch((err) => {
      console.warn(`[locker] Failed to remove torrent ${infoHash} from Transmission:`, err);
    });
  }

  // Soft-delete the LockerFile record and decrement quota
  const lockerFile = await db.lockerFile.findUnique({ where: { entryId } });
  if (lockerFile) {
    await db.lockerFile.update({
      where: { entryId },
      data: { deletedAt: new Date() },
    });
    await storage.decrementQuota(userId, lockerFile.size);
  }

  // Mark files for cleanup (actual deletion in Phase 9.10 cron)
  await storage.markForCleanup(userId, entryId);

  return { success: true };
}

// ─── Torrent File ───────────────────────────────────────────────────

/**
 * Get the .torrent file for a locker entry.
 * Verifies that the entry belongs to the requesting user.
 */
export async function getTorrentFile(
  userId: string,
  entryId: string,
): Promise<Buffer> {
  const pubkey = await getUserPubkey(userId);

  // Verify ownership by checking for matching event
  const events = await queryEvents({
    kinds: [LOCKER_ENTRY_KIND],
    authors: [pubkey],
    limit: 500,
  });

  const ownsEntry = events.some((event) =>
    event.tags.some((tag) => tag[0] === "d" && tag[1] === entryId),
  );

  if (!ownsEntry) {
    throw new NotFoundError("Locker entry");
  }

  // Read the .torrent file from disk
  try {
    return await storage.readTorrentFile(userId, entryId);
  } catch {
    throw new NotFoundError("Torrent file for locker entry");
  }
}
