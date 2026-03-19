/**
 * Data Locker types and utilities.
 *
 * Locker entries represent files stored in a user's personal data locker.
 * Each entry is published as a NIP-78 (kind 30078) parameterized replaceable
 * Nostr event, with the content field holding NIP-44 encrypted JSON.
 */

// ─── Constants ──────────────────────────────────────────────────────

/** NIP-78 application-specific data — used for locker entries. */
export const LOCKER_ENTRY_KIND = 30078;

// ─── Types ──────────────────────────────────────────────────────────

export interface LockerEntry {
  /** Unique entry ID (UUID v4). */
  id: string;
  /** Original filename. */
  filename: string;
  /** File size in bytes. */
  size: number;
  /** Detected MIME type (e.g. "application/pdf"). */
  mimeType: string;
  /** SHA-256 hex digest of file contents for integrity verification. */
  sha256: string;
  /** BitTorrent info hash (40-char hex). */
  infoHash: string;
  /** Full magnet URI including trackers. */
  magnetUri: string;
  /** Unix timestamp (seconds) when the entry was created. */
  createdAt: number;
  /** User-defined tags for organization (virtual folders). */
  tags: string[];
  /** Entry version number — incremented on updates. */
  version: number;
  /** Optional peer hints for P2P fallback — array of "ip:port" strings. */
  peerHints?: string[];
}

// ─── Validation ─────────────────────────────────────────────────────

const HEX_64 = /^[0-9a-f]{64}$/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Type guard that validates an unknown value is a well-formed LockerEntry.
 *
 * Checks:
 * - All required fields are present
 * - Correct types for every field
 * - id is a valid UUID
 * - sha256 is a 64-char hex string
 * - infoHash is a 40-char hex string
 * - magnetUri starts with "magnet:"
 * - size >= 0 and is a safe integer
 * - createdAt >= 0 and is a safe integer
 * - version >= 1 and is a safe integer
 * - tags is an array of strings
 * - filename is non-empty
 * - mimeType is non-empty
 */
export function validateLockerEntry(entry: unknown): entry is LockerEntry {
  if (entry === null || typeof entry !== "object") return false;

  const e = entry as Record<string, unknown>;

  // String fields
  if (typeof e.id !== "string" || !UUID_RE.test(e.id)) return false;
  if (typeof e.filename !== "string" || e.filename.length === 0) return false;
  if (typeof e.mimeType !== "string" || e.mimeType.length === 0) return false;
  if (typeof e.sha256 !== "string" || !HEX_64.test(e.sha256)) return false;
  if (
    typeof e.infoHash !== "string" ||
    e.infoHash.length !== 40 ||
    !/^[0-9a-f]{40}$/i.test(e.infoHash)
  )
    return false;
  if (
    typeof e.magnetUri !== "string" ||
    !e.magnetUri.startsWith("magnet:")
  )
    return false;

  // Numeric fields
  if (
    typeof e.size !== "number" ||
    !Number.isSafeInteger(e.size) ||
    e.size < 0
  )
    return false;
  if (
    typeof e.createdAt !== "number" ||
    !Number.isSafeInteger(e.createdAt) ||
    e.createdAt < 0
  )
    return false;
  if (
    typeof e.version !== "number" ||
    !Number.isSafeInteger(e.version) ||
    e.version < 1
  )
    return false;

  // Tags array
  if (!Array.isArray(e.tags)) return false;
  for (const tag of e.tags) {
    if (typeof tag !== "string") return false;
  }

  // Optional peerHints
  if (e.peerHints !== undefined) {
    if (!Array.isArray(e.peerHints)) return false;
    for (const hint of e.peerHints) {
      if (typeof hint !== "string") return false;
    }
  }

  return true;
}

// ─── Serialization ──────────────────────────────────────────────────

/**
 * Serialize a LockerEntry to JSON string.
 * This is the plaintext that gets NIP-44 encrypted before publishing.
 */
export function serializeLockerEntry(entry: LockerEntry): string {
  return JSON.stringify(entry);
}

/**
 * Deserialize a JSON string to a LockerEntry.
 * Throws if the JSON is invalid or doesn't pass validation.
 */
export function deserializeLockerEntry(json: string): LockerEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON for LockerEntry");
  }

  if (!validateLockerEntry(parsed)) {
    throw new Error("Invalid LockerEntry: failed validation");
  }

  return parsed;
}

// ─── Nostr Event Helpers ────────────────────────────────────────────

/**
 * Build the Nostr event tags array for a locker entry.
 *
 * Returns:
 * - `["d", entry.id]` — parameterized replaceable (NIP-33): one event per entry ID
 * - `["t", tag]` for each user tag — enables tag-based filtering via relay queries
 */
export function buildLockerEventTags(entry: LockerEntry): string[][] {
  const tags: string[][] = [["d", entry.id]];
  for (const tag of entry.tags) {
    tags.push(["t", tag]);
  }
  return tags;
}
