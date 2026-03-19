/**
 * NIP-44 v2 Encryption — Encrypted Direct Messages (self-addressed & sharing)
 *
 * Spec: https://github.com/nostr-protocol/nips/blob/master/44.md
 *
 * Flow:
 *   1. ECDH shared secret (secp256k1)
 *   2. HKDF-SHA256 → 32-byte conversation key
 *   3. Pad plaintext (NIP-44 padding scheme)
 *   4. Encrypt with XChaCha20-Poly1305
 *   5. Payload: base64(0x02 || nonce || ciphertext+mac)
 *
 * For self-addressed messages (data locker): sender === recipient,
 * so the shared secret is ECDH(privkey, own_pubkey).
 */

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { extract, expand } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes, hexToBytes } from "@noble/hashes/utils.js";

const NIP44_VERSION = 0x02;
const MIN_PADDED_LENGTH = 32;
const NONCE_LENGTH = 24;

// ─── Conversation Key Derivation ──────────────────────────────────

/**
 * Derive a 32-byte conversation key from ECDH shared secret using HKDF.
 * The shared secret is the x-coordinate of the ECDH point.
 */
export function getConversationKey(
  senderPrivkey: string,
  recipientPubkey: string,
): Uint8Array {
  // secp256k1 getSharedSecret expects Uint8Array inputs.
  // recipientPubkey is a 32-byte hex x-only key; prepend 02 for compressed form.
  const sharedPoint = secp256k1.getSharedSecret(
    hexToBytes(senderPrivkey),
    hexToBytes("02" + recipientPubkey),
  );
  // x-coordinate only: bytes 1..33 of the 33-byte compressed point
  const sharedX = sharedPoint.slice(1, 33);

  // HKDF extract + expand with salt "nip44-v2"
  const salt = new TextEncoder().encode("nip44-v2");
  const prk = extract(sha256, sharedX, salt);
  return expand(sha256, prk, undefined, 32);
}

// ─── NIP-44 Padding ───────────────────────────────────────────────

/**
 * Calculate the padded length per NIP-44 spec.
 * For lengths up to 32, returns 32. Otherwise, returns the next power of 2.
 */
function calcPaddedLength(unpaddedLen: number): number {
  if (unpaddedLen <= 0) throw new Error("Plaintext must not be empty");
  if (unpaddedLen <= MIN_PADDED_LENGTH) return MIN_PADDED_LENGTH;

  // Next power of 2 (NIP-44 spec: "next power of 2")
  // For lengths > 32, round up to nearest power of 2
  const nextPow2 = 1 << (32 - Math.clz32(unpaddedLen - 1));
  return nextPow2;
}

/**
 * Pad plaintext per NIP-44 spec:
 *   - 2-byte big-endian length prefix
 *   - plaintext bytes
 *   - zero-padding to padded length
 */
function pad(plaintext: Uint8Array): Uint8Array {
  const unpaddedLen = plaintext.length;
  const paddedLen = calcPaddedLength(unpaddedLen);
  // Total = 2 (length prefix) + paddedLen
  const result = new Uint8Array(2 + paddedLen);
  // Big-endian length prefix
  result[0] = (unpaddedLen >> 8) & 0xff;
  result[1] = unpaddedLen & 0xff;
  // Copy plaintext after the 2-byte prefix
  result.set(plaintext, 2);
  // Rest is already zero-filled
  return result;
}

/**
 * Unpad: read the 2-byte length prefix, extract that many bytes.
 */
function unpad(padded: Uint8Array): Uint8Array {
  if (padded.length < 2 + MIN_PADDED_LENGTH) {
    throw new Error("Invalid padded data: too short");
  }
  const unpaddedLen = (padded[0] << 8) | padded[1];
  if (unpaddedLen === 0) {
    throw new Error("Invalid padded data: zero length");
  }
  const paddedLen = padded.length - 2;
  const expectedPaddedLen = calcPaddedLength(unpaddedLen);
  if (paddedLen !== expectedPaddedLen) {
    throw new Error("Invalid padding length");
  }
  if (unpaddedLen > paddedLen) {
    throw new Error("Invalid padded data: length exceeds padding");
  }
  return padded.slice(2, 2 + unpaddedLen);
}

// ─── Encrypt / Decrypt ────────────────────────────────────────────

/**
 * Encrypt plaintext using NIP-44 v2.
 *
 * @param plaintext - UTF-8 string to encrypt
 * @param senderPrivkey - Sender's private key (hex, 64 chars)
 * @param recipientPubkey - Recipient's x-only public key (hex, 64 chars)
 * @returns Base64-encoded NIP-44 payload
 */
export function nip44Encrypt(
  plaintext: string,
  senderPrivkey: string,
  recipientPubkey: string,
): string {
  if (!plaintext) throw new Error("Plaintext must not be empty");

  const conversationKey = getConversationKey(senderPrivkey, recipientPubkey);
  const nonce = randomBytes(NONCE_LENGTH);
  const padded = pad(new TextEncoder().encode(plaintext));

  // XChaCha20-Poly1305 encrypt — returns ciphertext + 16-byte Poly1305 tag appended
  const cipher = xchacha20poly1305(conversationKey, nonce);
  const ciphertextWithMac = cipher.encrypt(padded);

  // Payload: version byte + nonce + ciphertext+mac
  const payload = new Uint8Array(
    1 + NONCE_LENGTH + ciphertextWithMac.length,
  );
  payload[0] = NIP44_VERSION;
  payload.set(nonce, 1);
  payload.set(ciphertextWithMac, 1 + NONCE_LENGTH);

  // Base64 encode
  return bufferToBase64(payload);
}

/**
 * Decrypt a NIP-44 v2 payload.
 *
 * @param ciphertext - Base64-encoded NIP-44 payload
 * @param receiverPrivkey - Receiver's private key (hex, 64 chars)
 * @param senderPubkey - Sender's x-only public key (hex, 64 chars)
 * @returns Decrypted UTF-8 plaintext
 */
export function nip44Decrypt(
  ciphertext: string,
  receiverPrivkey: string,
  senderPubkey: string,
): string {
  const payload = base64ToBuffer(ciphertext);

  // Check version
  if (payload.length < 1 || payload[0] !== NIP44_VERSION) {
    throw new Error(
      `Unsupported NIP-44 version: ${payload.length > 0 ? payload[0] : "empty"}`,
    );
  }

  // Extract nonce and ciphertext+mac
  if (payload.length < 1 + NONCE_LENGTH + MIN_PADDED_LENGTH + 2 + 16) {
    throw new Error("Invalid NIP-44 payload: too short");
  }

  const nonce = payload.slice(1, 1 + NONCE_LENGTH);
  const ciphertextWithMac = payload.slice(1 + NONCE_LENGTH);

  const conversationKey = getConversationKey(receiverPrivkey, senderPubkey);

  // Decrypt — throws on authentication failure (tampered ciphertext)
  const cipher = xchacha20poly1305(conversationKey, nonce);
  const padded = cipher.decrypt(ciphertextWithMac);

  // Unpad and decode
  const plaintextBytes = unpad(padded);
  return new TextDecoder().decode(plaintextBytes);
}

// ─── Base64 Helpers ───────────────────────────────────────────────

function bufferToBase64(buf: Uint8Array): string {
  return Buffer.from(buf).toString("base64");
}

function base64ToBuffer(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}
