/**
 * Content-addressed deduplication for locker files.
 *
 * If two users upload the same file (same SHA-256), the second upload
 * reuses the existing file on disk via symlink, saving VPS storage.
 * Both users get their own LockerFile record and Nostr event, but
 * they share the same torrent (same infoHash, same magnetUri).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@boilerdeck/shared";

import type { Prisma } from "@prisma/client";

// ─── Types ──────────────────────────────────────────────────────────

// Use Prisma's generated type for the full LockerFile record
type LockerFileRecord = Prisma.LockerFileGetPayload<{}>;

export interface DuplicateInfo {
  /** The existing LockerFile record with matching SHA-256. */
  existingFile: LockerFileRecord;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Check if a file with the given SHA-256 already exists in the locker (non-deleted).
 * Returns the existing LockerFile record if found, null otherwise.
 */
export async function findDuplicate(sha256: string): Promise<LockerFileRecord | null> {
  if (!sha256) return null;

  const existing = await db.lockerFile.findFirst({
    where: {
      sha256,
      deletedAt: null,
    },
  });

  return existing;
}

/**
 * Create a symlink from newPath pointing to existingPath.
 * Creates parent directories if needed.
 *
 * On Windows, falls back to file copy since symlinks require admin privileges.
 */
export async function createSymlink(
  existingPath: string,
  newPath: string,
): Promise<void> {
  // Ensure parent directory exists
  await fs.mkdir(path.dirname(newPath), { recursive: true });

  try {
    await fs.symlink(existingPath, newPath);
  } catch (err: unknown) {
    // On Windows or systems where symlinks fail, fall back to hard link
    // (same inode, no extra disk space, but both paths must be on same filesystem)
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "ENOTSUP") {
      try {
        await fs.link(existingPath, newPath);
      } catch {
        // Last resort: copy the file (uses disk space, but at least works)
        await fs.copyFile(existingPath, newPath);
      }
    } else {
      throw err;
    }
  }
}
