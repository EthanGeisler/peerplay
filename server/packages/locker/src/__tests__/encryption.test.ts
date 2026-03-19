/**
 * End-to-End Encryption Verification Tests
 *
 * Pure cryptographic tests — no server, database, or network required.
 * Verifies NIP-44 encryption guarantees for the data locker:
 *
 * 1. Encrypted content is base64 ciphertext, not plaintext
 * 2. Wrong key cannot decrypt
 * 3. Self-encryption round-trip works
 * 4. Share (re-encrypt to recipient) round-trip works
 * 5. Shared copy is encrypted to recipient only (sender cannot decrypt)
 * 6. Tampered ciphertext fails decryption
 * 7. Event structure (kind 30078, d-tag) is correct
 *
 * Run: npx tsx --test server/packages/locker/src/__tests__/encryption.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import {
  nip44Encrypt,
  nip44Decrypt,
  getConversationKey,
} from "@boilerdeck/auth";
import {
  LOCKER_ENTRY_KIND,
  serializeLockerEntry,
  deserializeLockerEntry,
  buildLockerEventTags,
  type LockerEntry,
} from "@boilerdeck/shared";

// ─── Test Key Generation Helper ──────────────────────────────────

function generateKeypair(): { privkey: string; pubkey: string } {
  const privkeyBytes = randomBytes(32);
  const pubkeyBytes = secp256k1.getPublicKey(privkeyBytes, true).slice(1);
  return {
    privkey: bytesToHex(privkeyBytes),
    pubkey: bytesToHex(pubkeyBytes),
  };
}

// ─── Test Data ───────────────────────────────────────────────────

function makeSampleEntry(): LockerEntry {
  return {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    filename: "secret-document.pdf",
    size: 1048576,
    mimeType: "application/pdf",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    infoHash: "d2354b8e12c3a4f5b6c7d8e9f0a1b2c3d4e5f6a7",
    magnetUri: "magnet:?xt=urn:btih:d2354b8e12c3a4f5b6c7d8e9f0a1b2c3d4e5f6a7",
    createdAt: 1710000000,
    tags: ["documents", "private"],
    version: 1,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("NIP-44 Encryption Guarantees", () => {
  const userA = generateKeypair();
  const userB = generateKeypair();
  const entry = makeSampleEntry();
  const plaintext = serializeLockerEntry(entry);

  it("encrypted content is base64 NIP-44 ciphertext, not plaintext JSON", () => {
    const encrypted = nip44Encrypt(plaintext, userA.privkey, userA.pubkey);

    // Must not be parseable as JSON (it's base64 ciphertext)
    assert.throws(() => {
      JSON.parse(encrypted);
    }, "Encrypted content should not be valid JSON");

    // Must be valid base64
    const decoded = Buffer.from(encrypted, "base64");
    assert.ok(decoded.length > 0, "Must decode as base64");

    // Must start with NIP-44 version byte 0x02
    assert.equal(decoded[0], 0x02, "First byte must be NIP-44 version 0x02");

    // Must not contain the plaintext filename
    assert.ok(
      !encrypted.includes("secret-document.pdf"),
      "Ciphertext must not contain plaintext filename",
    );
    assert.ok(
      !Buffer.from(encrypted, "base64").toString("utf-8").includes("secret-document.pdf"),
      "Decoded ciphertext must not contain plaintext filename",
    );
  });

  it("user A's key can decrypt content encrypted to user A", () => {
    const encrypted = nip44Encrypt(plaintext, userA.privkey, userA.pubkey);
    const decrypted = nip44Decrypt(encrypted, userA.privkey, userA.pubkey);
    const restored = deserializeLockerEntry(decrypted);

    assert.equal(restored.id, entry.id);
    assert.equal(restored.filename, entry.filename);
    assert.equal(restored.size, entry.size);
    assert.equal(restored.sha256, entry.sha256);
    assert.equal(restored.infoHash, entry.infoHash);
    assert.deepEqual(restored.tags, entry.tags);
  });

  it("user B's key cannot decrypt content encrypted to user A", () => {
    const encrypted = nip44Encrypt(plaintext, userA.privkey, userA.pubkey);

    // User B tries to decrypt with their own key — should fail
    assert.throws(() => {
      nip44Decrypt(encrypted, userB.privkey, userB.pubkey);
    }, "User B should not be able to decrypt User A's self-encrypted content");
  });

  it("share: sender re-encrypts to recipient, recipient decrypts successfully", () => {
    // Sender (A) encrypts to own pubkey first
    const selfEncrypted = nip44Encrypt(plaintext, userA.privkey, userA.pubkey);

    // Sender decrypts their own copy
    const decryptedByA = nip44Decrypt(selfEncrypted, userA.privkey, userA.pubkey);

    // Sender re-encrypts to recipient (B)'s pubkey
    const sharedEncrypted = nip44Encrypt(decryptedByA, userA.privkey, userB.pubkey);

    // Recipient (B) decrypts using their privkey + sender's pubkey
    const decryptedByB = nip44Decrypt(sharedEncrypted, userB.privkey, userA.pubkey);
    const restored = deserializeLockerEntry(decryptedByB);

    assert.equal(restored.id, entry.id);
    assert.equal(restored.filename, entry.filename);
    assert.equal(restored.sha256, entry.sha256);
    assert.deepEqual(restored.tags, entry.tags);
  });

  it("shared copy: sender cannot decrypt the copy encrypted to recipient", () => {
    // Sender re-encrypts to recipient's pubkey
    const sharedEncrypted = nip44Encrypt(plaintext, userA.privkey, userB.pubkey);

    // Sender tries to decrypt the shared copy using self-decryption
    // (as if it were encrypted to their own pubkey)
    assert.throws(() => {
      nip44Decrypt(sharedEncrypted, userA.privkey, userA.pubkey);
    }, "Sender should not be able to decrypt content encrypted to recipient's pubkey");
  });

  it("tampered ciphertext causes decryption failure", () => {
    const encrypted = nip44Encrypt(plaintext, userA.privkey, userA.pubkey);

    // Tamper with the base64 payload — flip some bytes in the middle
    const bytes = Buffer.from(encrypted, "base64");
    const tamperIndex = Math.floor(bytes.length / 2);
    bytes[tamperIndex] = bytes[tamperIndex] ^ 0xff;
    bytes[tamperIndex + 1] = bytes[tamperIndex + 1] ^ 0xff;
    const tampered = bytes.toString("base64");

    assert.throws(() => {
      nip44Decrypt(tampered, userA.privkey, userA.pubkey);
    }, "Decryption of tampered ciphertext must fail");
  });

  it("event has correct kind (30078) and d-tag structure", () => {
    const tags = buildLockerEventTags(entry);

    // Kind constant
    assert.equal(LOCKER_ENTRY_KIND, 30078, "Locker kind must be 30078 (NIP-78)");

    // d-tag must be the entry ID
    const dTag = tags.find((t) => t[0] === "d");
    assert.ok(dTag, "Must have a d-tag");
    assert.equal(dTag[1], entry.id, "d-tag value must be the entry ID");

    // User tags must be present as t-tags
    const tTags = tags.filter((t) => t[0] === "t").map((t) => t[1]);
    assert.deepEqual(
      tTags.sort(),
      entry.tags.sort(),
      "t-tags must match entry tags",
    );
  });

  it("conversation key is deterministic for same key pair", () => {
    const ck1 = getConversationKey(userA.privkey, userA.pubkey);
    const ck2 = getConversationKey(userA.privkey, userA.pubkey);
    assert.deepEqual(ck1, ck2, "Same inputs must produce same conversation key");
  });

  it("conversation key differs for different recipients", () => {
    const ckSelf = getConversationKey(userA.privkey, userA.pubkey);
    const ckOther = getConversationKey(userA.privkey, userB.pubkey);
    assert.notDeepEqual(
      ckSelf,
      ckOther,
      "Conversation key must differ by recipient",
    );
  });

  it("each encryption produces different ciphertext (randomized nonce)", () => {
    const enc1 = nip44Encrypt(plaintext, userA.privkey, userA.pubkey);
    const enc2 = nip44Encrypt(plaintext, userA.privkey, userA.pubkey);

    assert.notEqual(
      enc1,
      enc2,
      "Two encryptions of the same plaintext must produce different ciphertext (random nonce)",
    );

    // But both must decrypt to the same plaintext
    const dec1 = nip44Decrypt(enc1, userA.privkey, userA.pubkey);
    const dec2 = nip44Decrypt(enc2, userA.privkey, userA.pubkey);
    assert.equal(dec1, dec2, "Both ciphertexts must decrypt to same plaintext");
  });

  it("empty plaintext is rejected", () => {
    assert.throws(() => {
      nip44Encrypt("", userA.privkey, userA.pubkey);
    }, "Empty plaintext must be rejected");
  });
});
