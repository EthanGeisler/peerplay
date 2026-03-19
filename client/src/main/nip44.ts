/**
 * NIP-44 v2 Encryption — Client-side (Electron main process)
 *
 * Identical logic to server/packages/auth/src/nip44.ts but uses dynamic
 * imports for ESM-only packages (@noble/curves, @noble/ciphers, @noble/hashes)
 * because Electron main process compiles to CJS.
 *
 * Produces output cross-compatible with the server module.
 */

const NIP44_VERSION = 0x02;
const MIN_PADDED_LENGTH = 32;
const NONCE_LENGTH = 24;

// ─── Conversation Key Derivation ──────────────────────────────────

export async function getConversationKey(
  senderPrivkey: string,
  recipientPubkey: string,
): Promise<Uint8Array> {
  const { secp256k1 } = await import("@noble/curves/secp256k1.js");
  const { extract, expand } = await import("@noble/hashes/hkdf.js");
  const { sha256 } = await import("@noble/hashes/sha2.js");
  const { hexToBytes } = await import("@noble/hashes/utils.js");

  const sharedPoint = secp256k1.getSharedSecret(
    hexToBytes(senderPrivkey),
    hexToBytes("02" + recipientPubkey),
  );
  const sharedX = sharedPoint.slice(1, 33);

  const salt = new TextEncoder().encode("nip44-v2");
  const prk = extract(sha256, sharedX, salt);
  return expand(sha256, prk, undefined, 32);
}

// ─── NIP-44 Padding ───────────────────────────────────────────────

function calcPaddedLength(unpaddedLen: number): number {
  if (unpaddedLen <= 0) throw new Error("Plaintext must not be empty");
  if (unpaddedLen <= MIN_PADDED_LENGTH) return MIN_PADDED_LENGTH;
  const nextPow2 = 1 << (32 - Math.clz32(unpaddedLen - 1));
  return nextPow2;
}

function pad(plaintext: Uint8Array): Uint8Array {
  const unpaddedLen = plaintext.length;
  const paddedLen = calcPaddedLength(unpaddedLen);
  const result = new Uint8Array(2 + paddedLen);
  result[0] = (unpaddedLen >> 8) & 0xff;
  result[1] = unpaddedLen & 0xff;
  result.set(plaintext, 2);
  return result;
}

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
export async function nip44Encrypt(
  plaintext: string,
  senderPrivkey: string,
  recipientPubkey: string,
): Promise<string> {
  if (!plaintext) throw new Error("Plaintext must not be empty");

  const { xchacha20poly1305 } = await import("@noble/ciphers/chacha.js");
  const { randomBytes } = await import("@noble/hashes/utils.js");

  const conversationKey = await getConversationKey(senderPrivkey, recipientPubkey);
  const nonce = randomBytes(NONCE_LENGTH);
  const padded = pad(new TextEncoder().encode(plaintext));

  const cipher = xchacha20poly1305(conversationKey, nonce);
  const ciphertextWithMac = cipher.encrypt(padded);

  const payload = new Uint8Array(1 + NONCE_LENGTH + ciphertextWithMac.length);
  payload[0] = NIP44_VERSION;
  payload.set(nonce, 1);
  payload.set(ciphertextWithMac, 1 + NONCE_LENGTH);

  return Buffer.from(payload).toString("base64");
}

/**
 * Decrypt a NIP-44 v2 payload.
 *
 * @param ciphertext - Base64-encoded NIP-44 payload
 * @param receiverPrivkey - Receiver's private key (hex, 64 chars)
 * @param senderPubkey - Sender's x-only public key (hex, 64 chars)
 * @returns Decrypted UTF-8 plaintext
 */
export async function nip44Decrypt(
  ciphertext: string,
  receiverPrivkey: string,
  senderPubkey: string,
): Promise<string> {
  const { xchacha20poly1305 } = await import("@noble/ciphers/chacha.js");

  const payload = new Uint8Array(Buffer.from(ciphertext, "base64"));

  if (payload.length < 1 || payload[0] !== NIP44_VERSION) {
    throw new Error(
      `Unsupported NIP-44 version: ${payload.length > 0 ? payload[0] : "empty"}`,
    );
  }

  if (payload.length < 1 + NONCE_LENGTH + MIN_PADDED_LENGTH + 2 + 16) {
    throw new Error("Invalid NIP-44 payload: too short");
  }

  const nonce = payload.slice(1, 1 + NONCE_LENGTH);
  const ciphertextWithMac = payload.slice(1 + NONCE_LENGTH);

  const conversationKey = await getConversationKey(receiverPrivkey, senderPubkey);

  const cipher = xchacha20poly1305(conversationKey, nonce);
  const padded = cipher.decrypt(ciphertextWithMac);

  const plaintextBytes = unpad(padded);
  return new TextDecoder().decode(plaintextBytes);
}
