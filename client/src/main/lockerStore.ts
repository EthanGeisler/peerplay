/**
 * Locker Store — JSON file-based local index for data locker entries.
 *
 * Stores per-entry metadata and download status in `userData/locker-index.json`.
 * Provides fast local lookups without network access.
 */

import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ──────────────────────────────────────────────────────────

export type DownloadStatus = "available" | "downloading" | "downloaded" | "seeding" | "error";

export interface LockerIndexEntry {
  entryId: string;
  filename: string;
  size: number;
  mimeType: string;
  sha256: string;
  infoHash: string;
  magnetUri: string;
  tags: string[];
  downloadStatus: DownloadStatus;
  localPath: string | null;
  lastSynced: number; // unix timestamp
  createdAt: number; // unix timestamp
  version: number;
}

// ─── State ──────────────────────────────────────────────────────────

let indexPath: string | null = null;
let entries: LockerIndexEntry[] = [];

function getIndexPath(): string {
  if (!indexPath) {
    indexPath = path.join(app.getPath("userData"), "locker-index.json");
  }
  return indexPath;
}

function saveToFile(): void {
  try {
    fs.writeFileSync(getIndexPath(), JSON.stringify(entries, null, 2), "utf-8");
  } catch (err) {
    console.error("[locker-store] Failed to save index:", err);
  }
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Load the local locker index from disk.
 * Returns the current entries array.
 */
export function loadIndex(): LockerIndexEntry[] {
  try {
    const raw = fs.readFileSync(getIndexPath(), "utf-8");
    entries = JSON.parse(raw) as LockerIndexEntry[];
    if (!Array.isArray(entries)) {
      entries = [];
    }
  } catch {
    entries = [];
  }
  return entries;
}

/**
 * Replace the entire index and save to disk.
 */
export function saveIndex(newEntries: LockerIndexEntry[]): void {
  entries = newEntries;
  saveToFile();
}

/**
 * Insert or update an entry in the index.
 * Matches by entryId. If found, merges; if not, appends.
 */
export function upsertEntry(entry: LockerIndexEntry): void {
  const idx = entries.findIndex((e) => e.entryId === entry.entryId);
  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.push(entry);
  }
  saveToFile();
}

/**
 * Remove an entry from the index by entryId.
 */
export function removeEntry(entryId: string): void {
  entries = entries.filter((e) => e.entryId !== entryId);
  saveToFile();
}

/**
 * Get a single entry by entryId, or null if not found.
 */
export function getEntry(entryId: string): LockerIndexEntry | null {
  return entries.find((e) => e.entryId === entryId) ?? null;
}

/**
 * Get all entries matching a given download status.
 */
export function getEntriesByStatus(status: DownloadStatus): LockerIndexEntry[] {
  return entries.filter((e) => e.downloadStatus === status);
}

/**
 * Update the download status (and optionally localPath) for an entry.
 */
export function setDownloadStatus(
  entryId: string,
  status: DownloadStatus,
  localPath?: string,
): void {
  const entry = entries.find((e) => e.entryId === entryId);
  if (entry) {
    entry.downloadStatus = status;
    if (localPath !== undefined) {
      entry.localPath = localPath;
    }
    saveToFile();
  }
}

/**
 * Get all entries in the local index.
 */
export function getAllEntries(): LockerIndexEntry[] {
  return [...entries];
}
