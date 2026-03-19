import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nip44Encrypt, nip44Decrypt, getConversationKey } from "../nip44.js";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// ─── Test helpers ─────────────────────────────────────────────────

function generateKeypair() {
  const privkey = schnorr.utils.randomSecretKey();
  const pubkey = schnorr.getPublicKey(privkey);
  return {
    privkeyHex: bytesToHex(privkey),
    pubkeyHex: bytesToHex(pubkey),
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe("NIP-44 Encryption", () => {
  // ── Round-trip ────────────────────────────────────────────────

  describe("round-trip", () => {
    it("encrypts and decrypts a short message", () => {
      const alice = generateKeypair();
      const bob = generateKeypair();

      const plaintext = "hello world";
      const encrypted = nip44Encrypt(plaintext, alice.privkeyHex, bob.pubkeyHex);
      const decrypted = nip44Decrypt(encrypted, bob.privkeyHex, alice.pubkeyHex);

      assert.equal(decrypted, plaintext);
    });

    it("encrypts and decrypts a long message", () => {
      const alice = generateKeypair();
      const bob = generateKeypair();

      const plaintext = "A".repeat(5000);
      const encrypted = nip44Encrypt(plaintext, alice.privkeyHex, bob.pubkeyHex);
      const decrypted = nip44Decrypt(encrypted, bob.privkeyHex, alice.pubkeyHex);

      assert.equal(decrypted, plaintext);
    });

    it("encrypts and decrypts unicode content", () => {
      const alice = generateKeypair();
      const bob = generateKeypair();

      const plaintext = "Hello 🌍 Привет 世界 こんにちは";
      const encrypted = nip44Encrypt(plaintext, alice.privkeyHex, bob.pubkeyHex);
      const decrypted = nip44Decrypt(encrypted, bob.privkeyHex, alice.pubkeyHex);

      assert.equal(decrypted, plaintext);
    });

    it("encrypts and decrypts JSON content (locker entry use case)", () => {
      const alice = generateKeypair();
      const bob = generateKeypair();

      const lockerEntry = JSON.stringify({
        id: "550e8400-e29b-41d4-a716-446655440000",
        filename: "photo.jpg",
        size: 1024000,
        mimeType: "image/jpeg",
        sha256: "a".repeat(64),
        infoHash: "b".repeat(40),
        magnetUri: "magnet:?xt=urn:btih:" + "b".repeat(40),
        createdAt: 1710000000,
        tags: ["photos"],
        version: 1,
      });

      const encrypted = nip44Encrypt(lockerEntry, alice.privkeyHex, bob.pubkeyHex);
      const decrypted = nip44Decrypt(encrypted, bob.privkeyHex, alice.pubkeyHex);

      assert.equal(decrypted, lockerEntry);
      assert.deepEqual(JSON.parse(decrypted), JSON.parse(lockerEntry));
    });
  });

  // ── Self-encryption ───────────────────────────────────────────

  describe("self-encryption", () => {
    it("encrypts to own pubkey and decrypts with own key", () => {
      const user = generateKeypair();

      const plaintext = "my secret locker data";
      const encrypted = nip44Encrypt(plaintext, user.privkeyHex, user.pubkeyHex);
      const decrypted = nip44Decrypt(encrypted, user.privkeyHex, user.pubkeyHex);

      assert.equal(decrypted, plaintext);
    });

    it("self-encryption conversation key is deterministic", () => {
      const user = generateKeypair();

      const key1 = getConversationKey(user.privkeyHex, user.pubkeyHex);
      const key2 = getConversationKey(user.privkeyHex, user.pubkeyHex);

      assert.deepEqual(key1, key2);
    });
  });

  // ── Cross-user ────────────────────────────────────────────────

  describe("cross-user", () => {
    it("alice encrypts to bob, bob decrypts", () => {
      const alice = generateKeypair();
      const bob = generateKeypair();

      const plaintext = "shared file metadata";
      const encrypted = nip44Encrypt(plaintext, alice.privkeyHex, bob.pubkeyHex);
      const decrypted = nip44Decrypt(encrypted, bob.privkeyHex, alice.pubkeyHex);

      assert.equal(decrypted, plaintext);
    });

    it("conversation key is symmetric (alice→bob === bob→alice)", () => {
      const alice = generateKeypair();
      const bob = generateKeypair();

      const keyAliceToBob = getConversationKey(alice.privkeyHex, bob.pubkeyHex);
      const keyBobToAlice = getConversationKey(bob.privkeyHex, alice.pubkeyHex);

      assert.deepEqual(keyAliceToBob, keyBobToAlice);
    });

    it("bob encrypts to alice, alice decrypts", () => {
      const alice = generateKeypair();
      const bob = generateKeypair();

      const plaintext = "reply from bob";
      const encrypted = nip44Encrypt(plaintext, bob.privkeyHex, alice.pubkeyHex);
      const decrypted = nip44Decrypt(encrypted, alice.privkeyHex, bob.pubkeyHex);

      assert.equal(decrypted, plaintext);
    });
  });

  // ── Format validation ─────────────────────────────────────────

  describe("format", () => {
    it("output is valid base64", () => {
      const user = generateKeypair();
      const encrypted = nip44Encrypt("test", user.privkeyHex, user.pubkeyHex);

      // Should not throw
      const decoded = Buffer.from(encrypted, "base64");
      // Re-encoding should match
      assert.equal(decoded.toString("base64"), encrypted);
    });

    it("payload starts with version byte 0x02", () => {
      const user = generateKeypair();
      const encrypted = nip44Encrypt("test", user.privkeyHex, user.pubkeyHex);

      const payload = Buffer.from(encrypted, "base64");
      assert.equal(payload[0], 0x02);
    });

    it("payload has correct structure: version(1) + nonce(24) + ciphertext+mac", () => {
      const user = generateKeypair();
      const encrypted = nip44Encrypt("test", user.privkeyHex, user.pubkeyHex);

      const payload = Buffer.from(encrypted, "base64");
      // version(1) + nonce(24) + padded(2+32) + mac(16) = 75 minimum
      assert.ok(payload.length >= 1 + 24 + 2 + 32 + 16);
    });

    it("each encryption produces different ciphertext (random nonce)", () => {
      const user = generateKeypair();
      const plaintext = "same plaintext";

      const encrypted1 = nip44Encrypt(plaintext, user.privkeyHex, user.pubkeyHex);
      const encrypted2 = nip44Encrypt(plaintext, user.privkeyHex, user.pubkeyHex);

      assert.notEqual(encrypted1, encrypted2);

      // But both decrypt to the same plaintext
      const decrypted1 = nip44Decrypt(encrypted1, user.privkeyHex, user.pubkeyHex);
      const decrypted2 = nip44Decrypt(encrypted2, user.privkeyHex, user.pubkeyHex);
      assert.equal(decrypted1, plaintext);
      assert.equal(decrypted2, plaintext);
    });
  });

  // ── Padding ───────────────────────────────────────────────────

  describe("padding", () => {
    it("short messages are padded to minimum 32 bytes", () => {
      const user = generateKeypair();

      const encHi = nip44Encrypt("hi", user.privkeyHex, user.pubkeyHex);
      const encHello = nip44Encrypt("hello world", user.privkeyHex, user.pubkeyHex);

      const payloadHi = Buffer.from(encHi, "base64");
      const payloadHello = Buffer.from(encHello, "base64");

      // Both "hi" (2 bytes) and "hello world" (11 bytes) pad to 32,
      // so encrypted size should be identical:
      // version(1) + nonce(24) + (2 + 32 padded) + mac(16) = 75
      assert.equal(payloadHi.length, payloadHello.length);
    });

    it("33-byte message pads to 64 bytes", () => {
      const user = generateKeypair();

      // 32 bytes = min pad, 33 bytes = next power of 2 = 64
      const msg32 = "a".repeat(32);
      const msg33 = "a".repeat(33);

      const enc32 = nip44Encrypt(msg32, user.privkeyHex, user.pubkeyHex);
      const enc33 = nip44Encrypt(msg33, user.privkeyHex, user.pubkeyHex);

      const payload32 = Buffer.from(enc32, "base64");
      const payload33 = Buffer.from(enc33, "base64");

      // 32-char → padded 32, total: 1+24+(2+32)+16 = 75
      // 33-char → padded 64, total: 1+24+(2+64)+16 = 107
      assert.equal(payload32.length, 75);
      assert.equal(payload33.length, 107);
    });
  });

  // ── Error handling ────────────────────────────────────────────

  describe("error handling", () => {
    it("rejects invalid version byte", () => {
      const user = generateKeypair();
      const encrypted = nip44Encrypt("test", user.privkeyHex, user.pubkeyHex);

      // Tamper with version byte
      const payload = Buffer.from(encrypted, "base64");
      payload[0] = 0x01; // wrong version
      const tampered = payload.toString("base64");

      assert.throws(
        () => nip44Decrypt(tampered, user.privkeyHex, user.pubkeyHex),
        /Unsupported NIP-44 version/,
      );
    });

    it("rejects tampered ciphertext", () => {
      const user = generateKeypair();
      const encrypted = nip44Encrypt("test", user.privkeyHex, user.pubkeyHex);

      // Flip a byte in the ciphertext area
      const payload = Buffer.from(encrypted, "base64");
      payload[30] ^= 0xff; // in the ciphertext region
      const tampered = payload.toString("base64");

      assert.throws(
        () => nip44Decrypt(tampered, user.privkeyHex, user.pubkeyHex),
        /invalid tag/,
      );
    });

    it("rejects decryption with wrong key", () => {
      const alice = generateKeypair();
      const bob = generateKeypair();
      const charlie = generateKeypair();

      const encrypted = nip44Encrypt("secret", alice.privkeyHex, bob.pubkeyHex);

      // Charlie tries to decrypt with his key (claiming alice sent it)
      assert.throws(
        () => nip44Decrypt(encrypted, charlie.privkeyHex, alice.pubkeyHex),
        /invalid tag/,
      );
    });

    it("rejects empty plaintext", () => {
      const user = generateKeypair();

      assert.throws(
        () => nip44Encrypt("", user.privkeyHex, user.pubkeyHex),
        /Plaintext must not be empty/,
      );
    });

    it("rejects truncated payload", () => {
      const user = generateKeypair();
      const encrypted = nip44Encrypt("test", user.privkeyHex, user.pubkeyHex);

      // Truncate to just version + nonce
      const payload = Buffer.from(encrypted, "base64");
      const truncated = payload.slice(0, 10).toString("base64");

      assert.throws(
        () => nip44Decrypt(truncated, user.privkeyHex, user.pubkeyHex),
        /too short/,
      );
    });
  });

  // ── Conversation key ──────────────────────────────────────────

  describe("conversation key", () => {
    it("produces a 32-byte key", () => {
      const alice = generateKeypair();
      const bob = generateKeypair();

      const key = getConversationKey(alice.privkeyHex, bob.pubkeyHex);
      assert.equal(key.length, 32);
    });

    it("different key pairs produce different conversation keys", () => {
      const alice = generateKeypair();
      const bob = generateKeypair();
      const charlie = generateKeypair();

      const keyAB = getConversationKey(alice.privkeyHex, bob.pubkeyHex);
      const keyAC = getConversationKey(alice.privkeyHex, charlie.pubkeyHex);

      assert.notDeepEqual(keyAB, keyAC);
    });
  });
});
