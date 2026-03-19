/**
 * Locker file storage abstraction.
 *
 * Handles file storage, torrent file management, and directory operations
 * for the data locker. Files are stored at LOCKER_DIR/<userId>/<entryId>/.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "@boilerdeck/shared";
import { getLockerConfig } from "./config.js";

// Default max bytes: 50 GB
const DEFAULT_MAX_BYTES = BigInt(50) * BigInt(1024) * BigInt(1024) * BigInt(1024); // 53687091200

// ─── Directory helpers ──────────────────────────────────────────────

/** Get the base directory for a user's locker files. */
export function getUserDir(userId: string): string {
  return path.join(getLockerConfig().LOCKER_DIR, userId);
}

/** Get the directory for a specific locker entry. */
export function getEntryDir(userId: string, entryId: string): string {
  return path.join(getUserDir(userId), entryId);
}

/** Get the path to a stored file within an entry directory. */
export function getFilePath(userId: string, entryId: string, filename: string): string {
  return path.join(getEntryDir(userId, entryId), filename);
}

/** Get the path to a .torrent file for an entry. */
export function getTorrentPath(userId: string, entryId: string): string {
  return path.join(getEntryDir(userId, entryId), `${entryId}.torrent`);
}

// ─── File operations ────────────────────────────────────────────────

/**
 * Save an uploaded file to the locker directory structure.
 * Moves file from multer temp location to LOCKER_DIR/<userId>/<entryId>/<filename>.
 *
 * @returns The final file path.
 */
export async function saveFile(
  tempPath: string,
  userId: string,
  entryId: string,
  filename: string,
): Promise<string> {
  const entryDir = getEntryDir(userId, entryId);
  await fs.mkdir(entryDir, { recursive: true });

  const destPath = getFilePath(userId, entryId, filename);
  await fs.rename(tempPath, destPath);
  return destPath;
}

/**
 * Save a .torrent buffer to disk alongside the entry.
 */
export async function saveTorrentFile(
  userId: string,
  entryId: string,
  torrentBuffer: Buffer,
): Promise<string> {
  const torrentPath = getTorrentPath(userId, entryId);
  await fs.writeFile(torrentPath, torrentBuffer);
  return torrentPath;
}

/**
 * Read a .torrent file from disk.
 */
export async function readTorrentFile(
  userId: string,
  entryId: string,
): Promise<Buffer> {
  const torrentPath = getTorrentPath(userId, entryId);
  return fs.readFile(torrentPath);
}

/**
 * Compute SHA-256 hash of a file by streaming it.
 */
export async function computeFileHash(filePath: string): Promise<string> {
  const fileHandle = await fs.open(filePath, "r");
  const stream = fileHandle.createReadStream();
  const hash = crypto.createHash("sha256");

  return new Promise((resolve, reject) => {
    stream.on("data", (chunk: string | Buffer) => hash.update(chunk));
    stream.on("end", () => {
      fileHandle.close().catch(() => {});
      resolve(hash.digest("hex"));
    });
    stream.on("error", (err) => {
      fileHandle.close().catch(() => {});
      reject(err);
    });
  });
}

/**
 * Get the total size of all files in a user's locker directory.
 */
export async function getUserStorageBytes(userId: string): Promise<number> {
  const userDir = getUserDir(userId);
  try {
    return await getDirectorySize(userDir);
  } catch {
    // Directory doesn't exist yet — zero usage
    return 0;
  }
}

async function getDirectorySize(dirPath: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(fullPath);
    } else {
      const stat = await fs.stat(fullPath);
      total += stat.size;
    }
  }
  return total;
}

/**
 * Mark an entry's directory for cleanup by creating a `.deleted` marker file.
 * The actual cleanup will be handled by a cron job in Phase 9.10.
 */
export async function markForCleanup(userId: string, entryId: string): Promise<void> {
  const entryDir = getEntryDir(userId, entryId);
  try {
    await fs.writeFile(path.join(entryDir, ".deleted"), new Date().toISOString());
  } catch {
    // Entry dir may not exist — non-fatal
  }
}

/**
 * Check if an entry directory exists.
 */
export async function entryExists(userId: string, entryId: string): Promise<boolean> {
  try {
    await fs.access(getEntryDir(userId, entryId));
    return true;
  } catch {
    return false;
  }
}

// ─── DB-based quota ────────────────────────────────────────────────

export interface QuotaInfo {
  used: bigint;
  max: bigint;
}

/**
 * Get a user's storage quota from the database.
 * Creates a default quota record if one doesn't exist.
 */
export async function getQuota(userId: string): Promise<QuotaInfo> {
  const quota = await db.lockerQuota.upsert({
    where: { userId },
    create: {
      userId,
      usedBytes: BigInt(0),
      maxBytes: DEFAULT_MAX_BYTES,
    },
    update: {},
  });

  return {
    used: quota.usedBytes,
    max: quota.maxBytes,
  };
}

/**
 * Increment quota usage after a successful upload.
 */
export async function incrementQuota(userId: string, fileSize: bigint): Promise<void> {
  await db.lockerQuota.upsert({
    where: { userId },
    create: {
      userId,
      usedBytes: fileSize,
      maxBytes: DEFAULT_MAX_BYTES,
    },
    update: {
      usedBytes: { increment: fileSize },
    },
  });
}

/**
 * Decrement quota usage after a deletion.
 */
export async function decrementQuota(userId: string, fileSize: bigint): Promise<void> {
  const quota = await db.lockerQuota.findUnique({ where: { userId } });
  if (!quota) return;

  // Prevent going below zero
  const newUsed = quota.usedBytes - fileSize;
  await db.lockerQuota.update({
    where: { userId },
    data: { usedBytes: newUsed < BigInt(0) ? BigInt(0) : newUsed },
  });
}
