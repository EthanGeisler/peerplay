import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Wrap (encrypt) a key using AES-256-GCM.
 * Returns: iv (12 bytes) + authTag (16 bytes) + ciphertext
 */
export function wrapKey(key: Buffer, kek: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

/**
 * Unwrap (decrypt) a key that was wrapped with wrapKey.
 * Expects: iv (12 bytes) + authTag (16 bytes) + ciphertext
 */
export function unwrapKey(wrapped: Buffer, kek: Buffer): Buffer {
  const iv = wrapped.subarray(0, 12);
  const authTag = wrapped.subarray(12, 28);
  const ciphertext = wrapped.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", kek, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Derive a per-user key from a master key using HKDF-SHA256.
 * Returns a 32-byte key.
 */
export function deriveUserKey(masterKey: Buffer, userId: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", masterKey, Buffer.alloc(0), userId, 32),
  );
}
