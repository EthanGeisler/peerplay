/**
 * Event kind definitions and validation functions.
 *
 * Defines all supported Nostr event kinds and provides per-kind validation
 * that checks required tags and content format. Used by the WebSocket relay
 * (ws.ts) and REST endpoints to validate incoming events before storage.
 *
 * Standard NIP kinds: 0 (profile), 1 (text note), 3 (follow list),
 *   5 (deletion), 7 (reaction)
 * Custom BoilerDeck kinds: 31337 (review), 31338 (attestation)
 */

import type { SignedEvent } from "@boilerdeck/shared";

// ─── Kind Constants ──────────────────────────────────────────────────

export const KIND_PROFILE = 0;
export const KIND_TEXT_NOTE = 1;
export const KIND_FOLLOW_LIST = 3;
export const KIND_DELETION = 5;
export const KIND_REACTION = 7;
export const KIND_REVIEW = 31337;
export const KIND_ATTESTATION = 31338;

/** All supported event kinds. */
export const SUPPORTED_KINDS = [
  KIND_PROFILE,
  KIND_TEXT_NOTE,
  KIND_FOLLOW_LIST,
  KIND_DELETION,
  KIND_REACTION,
  KIND_REVIEW,
  KIND_ATTESTATION,
] as const;

// ─── Validation Result ───────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  /** Descriptive error message when valid is false. Undefined when valid. */
  error?: string;
}

const VALID: ValidationResult = { valid: true };

function invalid(error: string): ValidationResult {
  return { valid: false, error };
}

// ─── Tag Helpers ─────────────────────────────────────────────────────

/** Find the first tag with the given name. Returns the full tag array or undefined. */
function findTag(tags: string[][], name: string): string[] | undefined {
  return tags.find((t) => t[0] === name);
}

/** Check that a tag exists and has a non-empty value at index 1. */
function hasTagWithValue(tags: string[][], name: string): boolean {
  const tag = findTag(tags, name);
  return tag !== undefined && typeof tag[1] === "string" && tag[1].length > 0;
}

// ─── Per-Kind Validators ─────────────────────────────────────────────

/**
 * Kind 0 — Profile (NIP-01).
 * Content must be a JSON string containing profile metadata.
 * Replaceable: one per pubkey.
 */
function validateProfile(event: SignedEvent): ValidationResult {
  if (event.content.length === 0) {
    return invalid("kind 0 (profile): content must not be empty");
  }
  try {
    const parsed = JSON.parse(event.content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return invalid("kind 0 (profile): content must be a JSON object");
    }
  } catch {
    return invalid("kind 0 (profile): content must be valid JSON");
  }
  return VALID;
}

/**
 * Kind 1 — Text Note (NIP-01).
 * Content is arbitrary text. No required tags.
 */
function validateTextNote(event: SignedEvent): ValidationResult {
  if (typeof event.content !== "string") {
    return invalid("kind 1 (text note): content must be a string");
  }
  return VALID;
}

/**
 * Kind 3 — Follow List (NIP-02).
 * Tags should contain ["p", pubkey] entries for followed users.
 * Content can be empty or contain relay metadata.
 */
function validateFollowList(event: SignedEvent): ValidationResult {
  // Validate that all "p" tags have a valid pubkey value
  for (const tag of event.tags) {
    if (tag[0] === "p") {
      if (typeof tag[1] !== "string" || tag[1].length === 0) {
        return invalid("kind 3 (follow list): each 'p' tag must have a non-empty pubkey value");
      }
    }
  }
  return VALID;
}

/**
 * Kind 5 — Deletion (NIP-09).
 * Must reference at least one event via ["e", eventId] tags.
 */
function validateDeletion(event: SignedEvent): ValidationResult {
  const eTags = event.tags.filter((t) => t[0] === "e");
  if (eTags.length === 0) {
    return invalid("kind 5 (deletion): must include at least one 'e' tag referencing an event to delete");
  }
  for (const tag of eTags) {
    if (typeof tag[1] !== "string" || tag[1].length === 0) {
      return invalid("kind 5 (deletion): each 'e' tag must have a non-empty event ID");
    }
  }
  return VALID;
}

/**
 * Kind 7 — Reaction (NIP-25).
 * Must reference the event being reacted to via ["e", eventId] tag.
 * Content is typically "+" (like), "-" (dislike), or an emoji.
 */
function validateReaction(event: SignedEvent): ValidationResult {
  if (!hasTagWithValue(event.tags, "e")) {
    return invalid("kind 7 (reaction): must include an 'e' tag referencing the event being reacted to");
  }
  if (event.content.length === 0) {
    return invalid("kind 7 (reaction): content must not be empty (use '+', '-', or an emoji)");
  }
  return VALID;
}

/**
 * Kind 31337 — Review (BoilerDeck custom).
 * Parameterized replaceable event — one review per user per game.
 * Required: ["d", slug] tag identifying the game.
 * Content: JSON with { rating, title, body }.
 */
function validateReview(event: SignedEvent): ValidationResult {
  if (!hasTagWithValue(event.tags, "d")) {
    return invalid("kind 31337 (review): must include a 'd' tag with the game slug");
  }

  if (event.content.length === 0) {
    return invalid("kind 31337 (review): content must not be empty");
  }

  try {
    const parsed = JSON.parse(event.content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return invalid("kind 31337 (review): content must be a JSON object");
    }
    if (typeof parsed.rating !== "number" || !Number.isInteger(parsed.rating) || parsed.rating < 1 || parsed.rating > 5) {
      return invalid("kind 31337 (review): content must include 'rating' as an integer between 1 and 5");
    }
  } catch {
    return invalid("kind 31337 (review): content must be valid JSON");
  }

  return VALID;
}

/**
 * Kind 31338 — Attestation (BoilerDeck custom).
 * Parameterized replaceable event — one attestation per (signer, seeder, infoHash).
 * Required: ["p", pubkey] tag (the seeder being attested) and ["d", identifier] tag.
 * Content: JSON with attestation data (infoHash, bytesDownloaded, etc.).
 */
function validateAttestation(event: SignedEvent): ValidationResult {
  if (!hasTagWithValue(event.tags, "p")) {
    return invalid("kind 31338 (attestation): must include a 'p' tag with the seeder's pubkey");
  }
  if (!hasTagWithValue(event.tags, "d")) {
    return invalid("kind 31338 (attestation): must include a 'd' tag with the attestation identifier");
  }

  if (event.content.length === 0) {
    return invalid("kind 31338 (attestation): content must not be empty");
  }

  try {
    const parsed = JSON.parse(event.content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return invalid("kind 31338 (attestation): content must be a JSON object");
    }
  } catch {
    return invalid("kind 31338 (attestation): content must be valid JSON");
  }

  return VALID;
}

// ─── Validator Registry ──────────────────────────────────────────────

/** Map of kind number to validation function. */
const validators = new Map<number, (event: SignedEvent) => ValidationResult>([
  [KIND_PROFILE, validateProfile],
  [KIND_TEXT_NOTE, validateTextNote],
  [KIND_FOLLOW_LIST, validateFollowList],
  [KIND_DELETION, validateDeletion],
  [KIND_REACTION, validateReaction],
  [KIND_REVIEW, validateReview],
  [KIND_ATTESTATION, validateAttestation],
]);

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Validate an event against its kind-specific rules.
 *
 * Checks required tags and content format for the event's kind.
 * Events with unknown kinds pass validation (relay should accept
 * unknown kinds per NIP-01 — filtering is the client's job).
 *
 * This does NOT verify the event signature — that is handled separately
 * by verifyEvent() from the shared crypto module.
 */
export function validateEventKind(event: SignedEvent): ValidationResult {
  const validator = validators.get(event.kind);
  if (!validator) {
    // Unknown kinds are accepted — NIP-01 relays should store all valid events
    return VALID;
  }
  return validator(event);
}

/**
 * Get the human-readable name for a kind number.
 * Returns "unknown" for unrecognized kinds.
 */
export function kindName(kind: number): string {
  switch (kind) {
    case KIND_PROFILE: return "profile";
    case KIND_TEXT_NOTE: return "text note";
    case KIND_FOLLOW_LIST: return "follow list";
    case KIND_DELETION: return "deletion";
    case KIND_REACTION: return "reaction";
    case KIND_REVIEW: return "review";
    case KIND_ATTESTATION: return "attestation";
    default: return "unknown";
  }
}

/**
 * Check if a kind number is one of the supported kinds.
 */
export function isSupportedKind(kind: number): boolean {
  return validators.has(kind);
}
