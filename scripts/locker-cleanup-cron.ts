#!/usr/bin/env npx tsx
/**
 * Locker Cleanup Cron Script
 *
 * Runs every 6 hours (or manually) to clean up expired locker files.
 *
 * Tasks:
 * 1. Find LockerFile records with deletedAt older than LOCKER_RETENTION_DAYS
 * 2. Remove their torrents from Transmission
 * 3. Delete the actual files from disk
 * 4. Hard-delete the LockerFile records from DB
 * 5. Find orphaned torrent files (no matching DB entry) and clean up
 * 6. Log storage stats: total locker storage, per-user breakdown, available disk space
 *
 * Usage:
 *   npx tsx scripts/locker-cleanup-cron.ts
 *
 * Environment:
 *   LOCKER_RETENTION_DAYS — days to keep deleted files (default: 30)
 *   LOCKER_DIR — locker file storage directory (default: ./data/locker)
 *   TRANSMISSION_RPC_URL — Transmission RPC endpoint
 *   DATABASE_URL — PostgreSQL connection string
 */

import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@boilerdeck/shared";

// ─── Configuration ──────────────────────────────────────────────────

const RETENTION_DAYS = process.env.LOCKER_RETENTION_DAYS
  ? parseInt(process.env.LOCKER_RETENTION_DAYS, 10)
  : 30;

const LOCKER_DIR = process.env.LOCKER_DIR || "./data/locker";

const TRANSMISSION_RPC_URL =
  process.env.TRANSMISSION_RPC_URL || "http://127.0.0.1:9091/transmission/rpc";

// ─── Transmission RPC helpers ────────────────────────────────────────

interface TransmissionTorrent {
  id: number;
  hashString: string;
  name: string;
  downloadDir: string;
  totalSize: number;
}

async function getTransmissionSessionId(): Promise<string> {
  const response = await fetch(TRANSMISSION_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "session-get" }),
  });

  if (response.status === 409) {
    const sessionId = response.headers.get("x-transmission-session-id");
    if (!sessionId) throw new Error("Transmission 409 but no session ID header");
    return sessionId;
  }

  const sessionId = response.headers.get("x-transmission-session-id");
  if (sessionId) return sessionId;

  throw new Error(`Unexpected Transmission response: ${response.status}`);
}

async function transmissionRpc(
  method: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const sessionId = await getTransmissionSessionId();

  const response = await fetch(TRANSMISSION_RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Transmission-Session-Id": sessionId,
    },
    body: JSON.stringify({ method, arguments: args }),
  });

  if (!response.ok) {
    throw new Error(`Transmission RPC HTTP ${response.status}`);
  }

  const data = await response.json() as { result: string; arguments?: Record<string, unknown> };
  if (data.result !== "success") {
    throw new Error(`Transmission RPC: ${data.result}`);
  }

  return data.arguments ?? {};
}

async function getLockerTorrentsFromTransmission(): Promise<TransmissionTorrent[]> {
  const result = await transmissionRpc("torrent-get", {
    fields: ["id", "hashString", "name", "downloadDir", "totalSize"],
  });

  const torrents = (result.torrents as TransmissionTorrent[]) ?? [];
  return torrents.filter((t) => t.downloadDir.includes(LOCKER_DIR));
}

async function removeTorrentsFromTransmission(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await transmissionRpc("torrent-remove", {
    ids,
    "delete-local-data": false,
  });
}

// ─── Formatting helpers ──────────────────────────────────────────────

function formatBytes(bytes: number | bigint): string {
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ─── Cleanup Tasks ───────────────────────────────────────────────────

/**
 * Task 1-4: Find expired entries, remove torrents, delete files, hard-delete DB records.
 */
async function cleanupExpiredEntries(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  const expired = await db.lockerFile.findMany({
    where: {
      deletedAt: { not: null, lt: cutoff },
    },
  });

  if (expired.length === 0) {
    console.log(`[cleanup] No expired entries (retention: ${RETENTION_DAYS} days)`);
    return 0;
  }

  console.log(`[cleanup] Found ${expired.length} expired entries (deleted > ${RETENTION_DAYS} days ago)`);

  // Collect info hashes for Transmission removal
  const infoHashes = new Set(expired.map((f) => f.infoHash.toLowerCase()));

  // Remove from Transmission
  let transmissionOk = true;
  try {
    const lockerTorrents = await getLockerTorrentsFromTransmission();
    const toRemove = lockerTorrents.filter((t) =>
      infoHashes.has(t.hashString.toLowerCase()),
    );

    if (toRemove.length > 0) {
      await removeTorrentsFromTransmission(toRemove.map((t) => t.id));
      console.log(`[cleanup] Removed ${toRemove.length} torrents from Transmission`);
    }
  } catch (err) {
    console.warn("[cleanup] Could not reach Transmission (continuing with file/DB cleanup):", err instanceof Error ? err.message : err);
    transmissionOk = false;
  }

  // Delete files from disk and hard-delete DB records
  let filesDeleted = 0;
  let fileErrors = 0;

  for (const file of expired) {
    try {
      // Delete the entry directory
      const entryDir = path.join(LOCKER_DIR, file.userId, file.entryId);
      try {
        await fs.rm(entryDir, { recursive: true, force: true });
      } catch {
        // Directory may not exist — non-fatal
      }

      // Hard-delete the DB record
      await db.lockerFile.delete({ where: { id: file.id } });
      filesDeleted++;
    } catch (err) {
      console.warn(`[cleanup] Error cleaning up ${file.entryId}:`, err instanceof Error ? err.message : err);
      fileErrors++;
    }
  }

  console.log(`[cleanup] Hard-deleted ${filesDeleted} entries (${fileErrors} errors)`);
  return filesDeleted;
}

/**
 * Task 5: Find orphaned torrent directories (on disk but no matching DB entry).
 */
async function cleanupOrphanedFiles(): Promise<number> {
  let orphanCount = 0;

  try {
    const userDirNames = await fs.readdir(LOCKER_DIR);

    for (const userId of userDirNames) {
      if (userId === ".tmp") continue;

      const userPath = path.join(LOCKER_DIR, userId);
      try {
        const stat = await fs.stat(userPath);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      let entryNames: string[];
      try {
        entryNames = await fs.readdir(userPath);
      } catch {
        continue;
      }

      for (const entryId of entryNames) {
        // Check if it's a directory
        try {
          const stat = await fs.stat(path.join(userPath, entryId));
          if (!stat.isDirectory()) continue;
        } catch {
          continue;
        }

        // Check if this entry exists in the DB
        const dbEntry = await db.lockerFile.findUnique({
          where: { entryId },
          select: { id: true },
        });

        if (!dbEntry) {
          // Orphaned directory — no DB record
          const entryPath = path.join(userPath, entryId);
          try {
            await fs.rm(entryPath, { recursive: true, force: true });
            console.log(`[cleanup] Removed orphaned directory: ${userId}/${entryId}`);
            orphanCount++;
          } catch (err) {
            console.warn(`[cleanup] Failed to remove orphan ${entryPath}:`, err instanceof Error ? err.message : err);
          }
        }
      }

      // If user directory is now empty, remove it
      try {
        const remaining = await fs.readdir(userPath);
        if (remaining.length === 0) {
          await fs.rmdir(userPath);
          console.log(`[cleanup] Removed empty user directory: ${userId}`);
        }
      } catch {
        // Non-fatal
      }
    }
  } catch (err) {
    // LOCKER_DIR may not exist yet
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[cleanup] Error scanning for orphans:", err instanceof Error ? err.message : err);
    }
  }

  if (orphanCount > 0) {
    console.log(`[cleanup] Removed ${orphanCount} orphaned directories`);
  } else {
    console.log("[cleanup] No orphaned directories found");
  }

  return orphanCount;
}

/**
 * Task 6: Log storage stats.
 */
async function logStorageStats(): Promise<void> {
  console.log("\n── Storage Stats ──");

  // Total locker storage from DB
  const totalResult = await db.lockerFile.aggregate({
    where: { deletedAt: null },
    _sum: { size: true },
    _count: true,
  });

  const totalSize = totalResult._sum.size ?? BigInt(0);
  const totalCount = totalResult._count;
  console.log(`Total active files: ${totalCount} (${formatBytes(totalSize)})`);

  // Soft-deleted (pending cleanup)
  const deletedResult = await db.lockerFile.aggregate({
    where: { deletedAt: { not: null } },
    _sum: { size: true },
    _count: true,
  });

  const deletedSize = deletedResult._sum.size ?? BigInt(0);
  const deletedCount = deletedResult._count;
  console.log(`Soft-deleted (pending cleanup): ${deletedCount} (${formatBytes(deletedSize)})`);

  // Per-user breakdown (top 10 by usage)
  const perUser = await db.lockerQuota.findMany({
    orderBy: { usedBytes: "desc" },
    take: 10,
    select: {
      userId: true,
      usedBytes: true,
      maxBytes: true,
    },
  });

  if (perUser.length > 0) {
    console.log("\nTop users by storage:");
    for (const q of perUser) {
      const pct = q.maxBytes > BigInt(0)
        ? ((Number(q.usedBytes) / Number(q.maxBytes)) * 100).toFixed(1)
        : "N/A";
      console.log(`  ${q.userId.slice(0, 8)}... : ${formatBytes(q.usedBytes)} / ${formatBytes(q.maxBytes)} (${pct}%)`);
    }
  }

  // Disk space
  try {
    const statfs = await fs.statfs(LOCKER_DIR);
    const diskTotal = Number(statfs.bsize) * Number(statfs.blocks);
    const diskAvail = Number(statfs.bsize) * Number(statfs.bavail);
    console.log(`\nDisk total: ${formatBytes(diskTotal)}`);
    console.log(`Disk available: ${formatBytes(diskAvail)}`);
    console.log(`Disk used by locker: ${formatBytes(totalSize)} (${((Number(totalSize) / diskTotal) * 100).toFixed(2)}% of disk)`);
  } catch {
    console.log("\nDisk stats: unavailable (LOCKER_DIR may not exist)");
  }

  console.log("───────────────────\n");
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Locker Cleanup Cron — ${new Date().toISOString()} ===`);
  console.log(`Retention: ${RETENTION_DAYS} days | Locker dir: ${LOCKER_DIR}`);
  console.log();

  // 1-4. Clean up expired entries
  const cleaned = await cleanupExpiredEntries();

  // 5. Clean up orphaned files
  const orphans = await cleanupOrphanedFiles();

  // 6. Log storage stats
  await logStorageStats();

  console.log(`=== Cleanup complete: ${cleaned} expired, ${orphans} orphans removed ===\n`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
