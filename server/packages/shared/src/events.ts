/**
 * Nostr-compatible event utilities (NIP-01).
 *
 * Event ID = SHA-256 of canonical JSON: [0, pubkey, created_at, kind, tags, content]
 * Signatures: Schnorr over secp256k1 (x-only pubkeys, 64-char hex)
 */

import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";

// ─── Kind Constants ──────────────────────────────────────────────────

export const EVENT_KIND_GAME_LISTING = 30001;
export const EVENT_KIND_GAME_VERSION = 30002;
export const EVENT_KIND_REVIEW = 31337;
export const EVENT_KIND_ATTESTATION = 31338;

// ─── Types ───────────────────────────────────────────────────────────

export interface UnsignedEvent {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export interface SignedEvent extends UnsignedEvent {
  id: string;
  sig: string;
}

// ─── Serialization ───────────────────────────────────────────────────

/**
 * NIP-01 canonical JSON serialization for hashing.
 * Format: [0, pubkey, created_at, kind, tags, content]
 *
 * Rules:
 * - No whitespace, no trailing commas
 * - created_at must be an integer
 * - tags is an array of arrays of strings
 * - content is always a string (caller must JSON.stringify objects before passing)
 * - UTF-8 encoded (JSON.stringify handles this natively)
 */
export function serializeEvent(event: UnsignedEvent): string {
  return JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
}

/**
 * Compute the NIP-01 event ID: SHA-256 of the canonical serialized form.
 * Returns 64-char lowercase hex string.
 */
export function hashEvent(event: UnsignedEvent): string {
  const serialized = serializeEvent(event);
  const bytes = new TextEncoder().encode(serialized);
  const hash = sha256(bytes);
  return Buffer.from(hash).toString("hex");
}

/**
 * Create a fully signed event from parameters and a private key.
 *
 * - Computes the event ID (SHA-256 of canonical JSON)
 * - Signs the ID with Schnorr/secp256k1
 * - Returns the complete signed event
 *
 * @param params - Event fields (pubkey, kind, tags, content)
 * @param privateKey - 32-byte private key as hex string or Uint8Array
 */
export function createEvent(
  params: UnsignedEvent,
  privateKey: Uint8Array | string,
): SignedEvent {
  const privKeyBytes =
    typeof privateKey === "string"
      ? Uint8Array.from(Buffer.from(privateKey, "hex"))
      : privateKey;

  // Validate created_at is a safe integer
  if (
    !Number.isSafeInteger(params.created_at) ||
    params.created_at < 0
  ) {
    throw new Error(
      `created_at must be a non-negative safe integer, got ${params.created_at}`,
    );
  }

  const id = hashEvent(params);
  const idBytes = Uint8Array.from(Buffer.from(id, "hex"));
  const sig = Buffer.from(schnorr.sign(idBytes, privKeyBytes)).toString("hex");

  return {
    id,
    pubkey: params.pubkey,
    created_at: params.created_at,
    kind: params.kind,
    tags: params.tags,
    content: params.content,
    sig,
  };
}

/**
 * Verify a signed event:
 * 1. Recompute the hash from canonical serialization
 * 2. Check that event.id matches the recomputed hash
 * 3. Verify the Schnorr signature over the hash using the event's pubkey
 *
 * Returns false (never throws) for any invalid/malformed input.
 */
export function verifyEvent(event: SignedEvent): boolean {
  try {
    // Validate required fields exist and have correct types
    if (
      typeof event.id !== "string" ||
      typeof event.pubkey !== "string" ||
      typeof event.sig !== "string" ||
      typeof event.content !== "string" ||
      typeof event.kind !== "number" ||
      typeof event.created_at !== "number" ||
      !Array.isArray(event.tags)
    ) {
      return false;
    }

    // Validate field lengths (id: 64 hex, pubkey: 64 hex x-only, sig: 128 hex)
    if (event.id.length !== 64 || !/^[0-9a-f]+$/i.test(event.id)) return false;
    if (event.pubkey.length !== 64 || !/^[0-9a-f]+$/i.test(event.pubkey))
      return false;
    if (event.sig.length !== 128 || !/^[0-9a-f]+$/i.test(event.sig))
      return false;

    // Recompute hash and verify id matches
    const expectedId = hashEvent(event);
    if (event.id !== expectedId) return false;

    // Verify Schnorr signature
    const idBytes = Uint8Array.from(Buffer.from(event.id, "hex"));
    const sigBytes = Uint8Array.from(Buffer.from(event.sig, "hex"));
    const pubkeyBytes = Uint8Array.from(Buffer.from(event.pubkey, "hex"));

    return schnorr.verify(sigBytes, idBytes, pubkeyBytes);
  } catch {
    return false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Extract the `d` tag value from an event's tags array.
 * Returns the value if found, `""` if d tag exists but has no value, or `null` if no d tag.
 */
export function extractDTag(tags: string[][]): string | null {
  for (const tag of tags) {
    if (tag[0] === "d") {
      return tag[1] ?? "";
    }
  }
  return null;
}

/**
 * Check if a kind is parameterized replaceable (30000-39999).
 * These events use the d tag for uniqueness within pubkey+kind.
 */
export function isReplaceableKind(kind: number): boolean {
  return kind >= 30000 && kind <= 39999;
}

/**
 * Normalize dTag for database storage.
 * - Replaceable kinds (30000-39999): always returns a string (never null)
 * - Other kinds: always returns null
 *
 * This prevents the PostgreSQL NULL uniqueness footgun where multiple NULLs
 * bypass the @@unique([pubkey, kind, dTag]) constraint.
 */
export function normalizeDTag(
  kind: number,
  tags: string[][],
): string | null {
  if (!isReplaceableKind(kind)) return null;
  const dTag = extractDTag(tags);
  return dTag ?? "";
}
