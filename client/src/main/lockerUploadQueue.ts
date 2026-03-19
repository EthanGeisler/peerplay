/**
 * Locker Upload Queue — Persistent queue for offline/failed uploads.
 *
 * When an upload fails due to network errors (server unreachable),
 * the upload is queued locally and retried with exponential backoff.
 *
 * Queue stored in `userData/locker-upload-queue.json`.
 */

import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────

export interface QueueItem {
  id: string;
  filePath: string;
  tags: string[];
  addedAt: number; // unix timestamp ms
  retryCount: number;
  lastError: string | null;
  lastRetryAt: number | null; // unix timestamp ms
  permanentlyFailed: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────

const MAX_RETRY_COUNT = 10;
const BASE_DELAY_MS = 60_000; // 1 minute
const MAX_DELAY_MS = 30 * 60_000; // 30 minutes

// ─── State ──────────────────────────────────────────────────────────

let queuePath: string | null = null;
let queue: QueueItem[] = [];
let processTimer: ReturnType<typeof setTimeout> | null = null;
let processing = false;

function getQueuePath(): string {
  if (!queuePath) {
    queuePath = path.join(app.getPath("userData"), "locker-upload-queue.json");
  }
  return queuePath;
}

function saveToFile(): void {
  try {
    fs.writeFileSync(getQueuePath(), JSON.stringify(queue, null, 2), "utf-8");
  } catch (err) {
    console.error("[locker-upload-queue] Failed to save queue:", err);
  }
}

function loadFromFile(): void {
  try {
    const raw = fs.readFileSync(getQueuePath(), "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      queue = parsed;
    } else {
      queue = [];
    }
  } catch {
    queue = [];
  }
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Load the queue from disk. Call on app startup.
 */
export function loadQueue(): QueueItem[] {
  loadFromFile();
  return [...queue];
}

/**
 * Add a failed upload to the queue.
 */
export function addToQueue(filePath: string, tags: string[], error: string): QueueItem {
  const item: QueueItem = {
    id: crypto.randomUUID(),
    filePath,
    tags,
    addedAt: Date.now(),
    retryCount: 0,
    lastError: error,
    lastRetryAt: null,
    permanentlyFailed: false,
  };
  queue.push(item);
  saveToFile();
  console.log(`[locker-upload-queue] Added to queue: ${path.basename(filePath)} (${item.id})`);
  return item;
}

/**
 * Get all queued items.
 */
export function getQueue(): QueueItem[] {
  return [...queue];
}

/**
 * Get count of pending (non-permanently-failed) items.
 */
export function getPendingCount(): number {
  return queue.filter((item) => !item.permanentlyFailed).length;
}

/**
 * Remove a specific item from the queue.
 */
export function removeFromQueue(id: string): void {
  queue = queue.filter((item) => item.id !== id);
  saveToFile();
}

/**
 * Clear all permanently failed items from the queue.
 */
export function clearFailed(): void {
  queue = queue.filter((item) => !item.permanentlyFailed);
  saveToFile();
}

/**
 * Process the queue — retry failed uploads.
 *
 * @param uploadFn - Function to attempt the upload. Should throw on failure.
 * @returns Number of successfully processed items.
 */
export async function processQueue(
  uploadFn: (filePath: string, tags: string[]) => Promise<void>,
): Promise<number> {
  if (processing) {
    console.log("[locker-upload-queue] Already processing, skipping");
    return 0;
  }

  processing = true;
  let successCount = 0;

  try {
    // Process items that are eligible for retry
    const now = Date.now();
    const eligible = queue.filter((item) => {
      if (item.permanentlyFailed) return false;
      if (item.retryCount >= MAX_RETRY_COUNT) {
        item.permanentlyFailed = true;
        return false;
      }

      // Check if enough time has passed since last retry (exponential backoff)
      if (item.lastRetryAt) {
        const delay = Math.min(
          BASE_DELAY_MS * Math.pow(2, item.retryCount - 1),
          MAX_DELAY_MS,
        );
        if (now - item.lastRetryAt < delay) return false;
      }

      // Check if file still exists
      try {
        fs.accessSync(item.filePath, fs.constants.R_OK);
        return true;
      } catch {
        item.permanentlyFailed = true;
        item.lastError = "File no longer accessible";
        return false;
      }
    });

    for (const item of eligible) {
      try {
        console.log(
          `[locker-upload-queue] Retrying ${path.basename(item.filePath)} (attempt ${item.retryCount + 1}/${MAX_RETRY_COUNT})`,
        );

        await uploadFn(item.filePath, item.tags);

        // Success — remove from queue
        queue = queue.filter((q) => q.id !== item.id);
        successCount++;
        console.log(`[locker-upload-queue] Retry successful: ${path.basename(item.filePath)}`);
      } catch (err) {
        item.retryCount++;
        item.lastRetryAt = Date.now();
        item.lastError = err instanceof Error ? err.message : String(err);

        if (item.retryCount >= MAX_RETRY_COUNT) {
          item.permanentlyFailed = true;
          console.warn(
            `[locker-upload-queue] Permanently failed after ${MAX_RETRY_COUNT} retries: ${path.basename(item.filePath)}`,
          );
        }
      }
    }

    saveToFile();
  } finally {
    processing = false;
  }

  return successCount;
}

/**
 * Schedule periodic queue processing.
 * Checks the queue every 2 minutes.
 */
export function startProcessing(
  uploadFn: (filePath: string, tags: string[]) => Promise<void>,
): void {
  stopProcessing();

  // Process immediately on start
  processQueue(uploadFn).catch((err) => {
    console.warn("[locker-upload-queue] Processing error:", err);
  });

  // Then every 2 minutes
  processTimer = setInterval(() => {
    if (getPendingCount() > 0) {
      processQueue(uploadFn).catch((err) => {
        console.warn("[locker-upload-queue] Processing error:", err);
      });
    }
  }, 2 * 60_000);
}

/**
 * Stop periodic queue processing.
 */
export function stopProcessing(): void {
  if (processTimer) {
    clearInterval(processTimer);
    processTimer = null;
  }
}

/**
 * Check if the queue has any pending items.
 */
export function hasPendingItems(): boolean {
  return getPendingCount() > 0;
}
