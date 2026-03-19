/**
 * Locker Seed Manager — VPS-side torrent management for locker files.
 *
 * Queries Transmission RPC for locker torrent stats, pauses torrents for
 * soft-deleted entries, removes torrents for expired entries, and reports
 * disk usage statistics.
 */

import fs from "node:fs/promises";
import os from "node:os";
import { db } from "@boilerdeck/shared";
import { getLockerConfig } from "./config.js";

// ─── Types ──────────────────────────────────────────────────────────

interface TransmissionTorrent {
  id: number;
  hashString: string;
  name: string;
  status: number; // 0=stopped, 1=check-wait, 2=checking, 3=dl-wait, 4=downloading, 5=seed-wait, 6=seeding
  totalSize: number;
  downloadDir: string;
  uploadedEver: number;
}

interface TransmissionResponse {
  result: string;
  arguments: {
    torrents?: TransmissionTorrent[];
  };
}

export interface LockerTorrentStats {
  active: number;
  paused: number;
  total: number;
  totalSize: number;
}

export interface StorageStats {
  totalBytes: number;
  lockerBytes: number;
  availableBytes: number;
}

// ─── Transmission RPC helpers ────────────────────────────────────────

const TRANSMISSION_RPC_URL =
  process.env.TRANSMISSION_RPC_URL || "http://127.0.0.1:9091/transmission/rpc";

/**
 * Get a Transmission session ID via the CSRF dance.
 */
async function getSessionId(): Promise<string> {
  const response = await fetch(TRANSMISSION_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "session-get" }),
  });

  if (response.status === 409) {
    const sessionId = response.headers.get("x-transmission-session-id");
    if (!sessionId) {
      throw new Error("Transmission returned 409 but no X-Transmission-Session-Id header");
    }
    return sessionId;
  }

  const sessionId = response.headers.get("x-transmission-session-id");
  if (sessionId) return sessionId;

  throw new Error(
    `Unexpected Transmission response: ${response.status} ${response.statusText}`,
  );
}

/**
 * Make a Transmission RPC call with session ID handling.
 */
async function transmissionRpc(
  method: string,
  args: Record<string, unknown> = {},
): Promise<TransmissionResponse> {
  const sessionId = await getSessionId();

  const response = await fetch(TRANSMISSION_RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Transmission-Session-Id": sessionId,
    },
    body: JSON.stringify({ method, arguments: args }),
  });

  if (!response.ok) {
    throw new Error(`Transmission RPC HTTP ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as TransmissionResponse;
  if (data.result !== "success") {
    throw new Error(`Transmission RPC result: ${data.result}`);
  }

  return data;
}

/**
 * Get all torrents from Transmission whose download directory is under LOCKER_DIR.
 */
async function getLockerTorrents(): Promise<TransmissionTorrent[]> {
  const lockerDir = getLockerConfig().LOCKER_DIR;

  const data = await transmissionRpc("torrent-get", {
    fields: ["id", "hashString", "name", "status", "totalSize", "downloadDir", "uploadedEver"],
  });

  const torrents = data.arguments.torrents ?? [];
  // Filter to locker torrents by download directory
  return torrents.filter((t) => t.downloadDir.includes(lockerDir));
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Get stats about locker torrents in Transmission.
 */
export async function getLockerTorrentStats(): Promise<LockerTorrentStats> {
  const torrents = await getLockerTorrents();

  let active = 0;
  let paused = 0;
  let totalSize = 0;

  for (const t of torrents) {
    // status 0 = stopped/paused
    if (t.status === 0) {
      paused++;
    } else {
      active++;
    }
    totalSize += t.totalSize;
  }

  return {
    active,
    paused,
    total: torrents.length,
    totalSize,
  };
}

/**
 * Find torrents for soft-deleted locker entries and pause them in Transmission.
 * Returns the number of torrents paused.
 */
export async function pauseDeletedTorrents(): Promise<number> {
  // Get all soft-deleted locker files
  const deletedFiles = await db.lockerFile.findMany({
    where: { deletedAt: { not: null } },
    select: { infoHash: true },
  });

  if (deletedFiles.length === 0) return 0;

  const deletedHashes = new Set(deletedFiles.map((f) => f.infoHash.toLowerCase()));
  const torrents = await getLockerTorrents();

  // Find active torrents that belong to deleted entries
  const toPause = torrents.filter(
    (t) => t.status !== 0 && deletedHashes.has(t.hashString.toLowerCase()),
  );

  if (toPause.length === 0) return 0;

  // Pause them
  await transmissionRpc("torrent-stop", {
    ids: toPause.map((t) => t.id),
  });

  return toPause.length;
}

/**
 * Remove torrents for entries deleted more than retentionDays ago.
 * Returns the number of torrents removed from Transmission.
 */
export async function removeExpiredTorrents(retentionDays: number): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const expiredFiles = await db.lockerFile.findMany({
    where: {
      deletedAt: { not: null, lt: cutoff },
    },
    select: { infoHash: true },
  });

  if (expiredFiles.length === 0) return 0;

  const expiredHashes = new Set(expiredFiles.map((f) => f.infoHash.toLowerCase()));
  const torrents = await getLockerTorrents();

  const toRemove = torrents.filter((t) =>
    expiredHashes.has(t.hashString.toLowerCase()),
  );

  if (toRemove.length === 0) return 0;

  // Remove from Transmission (keep local data — cleanup cron handles file deletion)
  await transmissionRpc("torrent-remove", {
    ids: toRemove.map((t) => t.id),
    "delete-local-data": false,
  });

  return toRemove.length;
}

/**
 * Get disk usage stats for locker storage.
 */
export async function getStorageStats(): Promise<StorageStats> {
  const lockerDir = getLockerConfig().LOCKER_DIR;

  // Total disk space (from the partition where LOCKER_DIR lives)
  // os.freemem() is RAM, not disk — use statfs if available (Node 18+)
  let totalBytes = 0;
  let availableBytes = 0;

  try {
    // Node 18.15+ has fs.statfs
    const statfs = await fs.statfs(lockerDir);
    totalBytes = Number(statfs.bsize) * Number(statfs.blocks);
    availableBytes = Number(statfs.bsize) * Number(statfs.bavail);
  } catch {
    // Fallback: can't determine disk stats, report zero
    totalBytes = 0;
    availableBytes = 0;
  }

  // Locker bytes from DB (sum of all non-deleted locker file sizes)
  const result = await db.lockerFile.aggregate({
    where: { deletedAt: null },
    _sum: { size: true },
  });

  const lockerBytes = Number(result._sum.size ?? BigInt(0));

  return { totalBytes, lockerBytes, availableBytes };
}
