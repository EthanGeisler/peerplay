/**
 * Async attestation validation for kind 31338 events.
 *
 * These checks require database access and cannot be done synchronously
 * in kinds.ts. Called from routes.ts and ws.ts after the synchronous
 * validateEventKind() passes.
 *
 * Checks:
 * 1. Unknown infoHash: the d tag value must reference an existing torrent
 * 2. Bytes validation: bytesDownloaded must not exceed the torrent's file size
 */

import { db } from "@boilerdeck/shared";
import type { SignedEvent } from "@boilerdeck/shared";
import type { ValidationResult } from "./kinds.js";
import { KIND_ATTESTATION } from "./kinds.js";

/**
 * Perform async DB validation for kind 31338 attestation events.
 *
 * Call this AFTER `validateEventKind()` passes (which handles structural
 * and synchronous checks). Returns `{ valid: true }` if all async checks
 * pass, or `{ valid: false, error }` with a descriptive message.
 *
 * For non-attestation events, returns `{ valid: true }` immediately.
 */
export async function validateAttestationAsync(
  event: SignedEvent,
): Promise<ValidationResult> {
  if (event.kind !== KIND_ATTESTATION) {
    return { valid: true };
  }

  // Extract infoHash from d tag
  const dTag = event.tags.find((t) => t[0] === "d");
  const infoHash = dTag?.[1];
  if (!infoHash) {
    // This should already be caught by synchronous validation, but guard anyway
    return { valid: false, error: "kind 31338 (attestation): missing d tag value" };
  }

  // Look up the torrent by infoHash
  const torrent = await db.torrent.findFirst({
    where: { infoHash },
    select: {
      id: true,
      version: {
        select: {
          fileSizeBytes: true,
        },
      },
    },
  });

  if (!torrent) {
    return { valid: false, error: "Unknown infoHash" };
  }

  // Parse content to get bytesDownloaded (already validated as JSON object by kinds.ts)
  let parsed: { bytesDownloaded?: number };
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return { valid: false, error: "kind 31338 (attestation): content must be valid JSON" };
  }

  const bytesDownloaded = parsed.bytesDownloaded;
  if (typeof bytesDownloaded !== "number") {
    return { valid: false, error: "kind 31338 (attestation): missing bytesDownloaded" };
  }

  // Check bytesDownloaded against torrent file size
  // fileSizeBytes is on the related GameVersion (BigInt in Prisma)
  if (torrent.version) {
    const fileSizeBytes = Number(torrent.version.fileSizeBytes);
    if (fileSizeBytes > 0 && bytesDownloaded > fileSizeBytes) {
      return { valid: false, error: "bytesDownloaded exceeds torrent file size" };
    }
  }

  return { valid: true };
}
