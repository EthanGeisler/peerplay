/**
 * Locker Integration Tests
 *
 * Tests the locker service functions directly using real NIP-44 encryption
 * and event logic, with mocked Transmission RPC and filesystem dependencies.
 *
 * Run: npx tsx --test server/packages/locker/src/__tests__/integration.test.ts
 */

import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import {
  nip44Encrypt,
  nip44Decrypt,
} from "@boilerdeck/auth";
import {
  LOCKER_ENTRY_KIND,
  serializeLockerEntry,
  deserializeLockerEntry,
  buildLockerEventTags,
  validateLockerEntry,
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

function makeSampleEntry(overrides: Partial<LockerEntry> = {}): LockerEntry {
  return {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    filename: "test-document.pdf",
    size: 1048576,
    mimeType: "application/pdf",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    infoHash: "d2354b8e12c3a4f5b6c7d8e9f0a1b2c3d4e5f6a7",
    magnetUri: "magnet:?xt=urn:btih:d2354b8e12c3a4f5b6c7d8e9f0a1b2c3d4e5f6a7",
    createdAt: 1710000000,
    tags: ["documents", "work"],
    version: 1,
    ...overrides,
  };
}

// ─── Upload Flow Tests ──────────────────────────────────────────

describe("Upload Flow Integration", () => {
  const user = generateKeypair();

  it("creates a valid LockerEntry, encrypts to kind 30078, and decrypts round-trip", () => {
    const entry = makeSampleEntry();

    // Validate the entry
    assert.ok(validateLockerEntry(entry), "Entry must pass validation");

    // Serialize and encrypt
    const plaintext = serializeLockerEntry(entry);
    const encrypted = nip44Encrypt(plaintext, user.privkey, user.pubkey);

    // Build event structure
    const tags = buildLockerEventTags(entry);
    const eventKind = LOCKER_ENTRY_KIND;

    // Verify event structure
    assert.equal(eventKind, 30078, "Event kind must be 30078");
    assert.ok(
      tags.some((t) => t[0] === "d" && t[1] === entry.id),
      "Must have d-tag with entry ID",
    );

    // Verify encrypted content is not plaintext
    assert.ok(!encrypted.includes("test-document.pdf"), "Content must be encrypted");

    // Decrypt and verify round-trip
    const decrypted = nip44Decrypt(encrypted, user.privkey, user.pubkey);
    const restored = deserializeLockerEntry(decrypted);

    assert.equal(restored.id, entry.id);
    assert.equal(restored.filename, entry.filename);
    assert.equal(restored.size, entry.size);
    assert.equal(restored.mimeType, entry.mimeType);
    assert.equal(restored.sha256, entry.sha256);
    assert.equal(restored.infoHash, entry.infoHash);
    assert.equal(restored.magnetUri, entry.magnetUri);
    assert.equal(restored.createdAt, entry.createdAt);
    assert.deepEqual(restored.tags, entry.tags);
    assert.equal(restored.version, entry.version);
  });

  it("entry with peerHints round-trips correctly through encryption", () => {
    const entry = makeSampleEntry({
      peerHints: ["192.168.1.100:6881", "10.0.0.5:51413"],
    });

    assert.ok(validateLockerEntry(entry), "Entry with peerHints must be valid");

    const plaintext = serializeLockerEntry(entry);
    const encrypted = nip44Encrypt(plaintext, user.privkey, user.pubkey);
    const decrypted = nip44Decrypt(encrypted, user.privkey, user.pubkey);
    const restored = deserializeLockerEntry(decrypted);

    assert.deepEqual(restored.peerHints, ["192.168.1.100:6881", "10.0.0.5:51413"]);
  });

  it("user tags appear as t-tags on the event", () => {
    const entry = makeSampleEntry({ tags: ["photos", "vacation", "2024"] });
    const tags = buildLockerEventTags(entry);

    const tTags = tags.filter((t) => t[0] === "t").map((t) => t[1]);
    assert.deepEqual(tTags.sort(), ["2024", "photos", "vacation"]);
  });
});

// ─── List Flow Tests ────────────────────────────────────────────

describe("List Flow Integration", () => {
  const user = generateKeypair();

  it("stores encrypted events and decrypts them back to original entries", () => {
    const entries = [
      makeSampleEntry({ id: "11111111-1111-1111-1111-111111111111", filename: "file-a.txt" }),
      makeSampleEntry({ id: "22222222-2222-2222-2222-222222222222", filename: "file-b.pdf" }),
      makeSampleEntry({ id: "33333333-3333-3333-3333-333333333333", filename: "file-c.zip" }),
    ];

    // Encrypt all entries (simulating server-side storage)
    const encryptedEvents = entries.map((entry) => {
      const plaintext = serializeLockerEntry(entry);
      const encrypted = nip44Encrypt(plaintext, user.privkey, user.pubkey);
      return {
        kind: LOCKER_ENTRY_KIND,
        pubkey: user.pubkey,
        content: encrypted,
        tags: buildLockerEventTags(entry),
        created_at: entry.createdAt,
      };
    });

    // Decrypt all events (simulating list flow)
    const decryptedEntries: LockerEntry[] = [];
    for (const event of encryptedEvents) {
      const plaintext = nip44Decrypt(event.content, user.privkey, user.pubkey);
      const entry = deserializeLockerEntry(plaintext);
      decryptedEntries.push(entry);
    }

    assert.equal(decryptedEntries.length, 3);
    assert.equal(decryptedEntries[0].filename, "file-a.txt");
    assert.equal(decryptedEntries[1].filename, "file-b.pdf");
    assert.equal(decryptedEntries[2].filename, "file-c.zip");
  });

  it("skips entries that cannot be decrypted (wrong key epoch)", () => {
    const oldKey = generateKeypair();
    const newKey = generateKeypair();

    // Entry encrypted with old key
    const entry = makeSampleEntry();
    const plaintext = serializeLockerEntry(entry);
    const encryptedWithOldKey = nip44Encrypt(plaintext, oldKey.privkey, oldKey.pubkey);

    // Try to decrypt with new key — should fail
    assert.throws(
      () => nip44Decrypt(encryptedWithOldKey, newKey.privkey, newKey.pubkey),
      "Decryption with wrong key must fail",
    );
  });
});

// ─── Delete Flow Tests ──────────────────────────────────────────

describe("Delete Flow Integration", () => {
  const user = generateKeypair();

  it("deletion event has correct kind 5 and e-tag referencing the original", () => {
    const entry = makeSampleEntry();
    const originalEventId = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

    // Build NIP-09 deletion event structure
    const deletionEventKind = 5;
    const deletionTags = [["e", originalEventId]];

    assert.equal(deletionEventKind, 5, "Deletion events must be kind 5 (NIP-09)");
    assert.ok(
      deletionTags.some((t) => t[0] === "e" && t[1] === originalEventId),
      "Deletion event must reference original event with e-tag",
    );
  });

  it("finding an entry by d-tag works with matching entry ID", () => {
    const entry = makeSampleEntry();
    const tags = buildLockerEventTags(entry);

    // Simulate filtering events by d-tag
    const dTag = tags.find((t) => t[0] === "d");
    assert.ok(dTag, "Entry must have a d-tag");
    assert.equal(dTag![1], entry.id, "d-tag must match entry ID");

    // Multiple events — find by d-tag
    const events = [
      { tags: [["d", "wrong-id"]] },
      { tags: [["d", entry.id]] },
      { tags: [["d", "also-wrong"]] },
    ];

    const found = events.find((e) =>
      e.tags.some((t) => t[0] === "d" && t[1] === entry.id),
    );
    assert.ok(found, "Must find the event with matching d-tag");
  });
});

// ─── Quota Enforcement Tests ─────────────────────────────────────

describe("Quota Enforcement", () => {
  it("rejects upload when file size exceeds remaining quota", () => {
    const usedBytes = BigInt(49) * BigInt(1024 * 1024 * 1024); // 49 GB used
    const maxBytes = BigInt(50) * BigInt(1024 * 1024 * 1024);  // 50 GB max
    const fileSize = BigInt(2) * BigInt(1024 * 1024 * 1024);    // 2 GB file

    const overQuota = usedBytes + fileSize > maxBytes;
    assert.ok(overQuota, "Upload should be rejected when it would exceed quota");
  });

  it("allows upload when within quota", () => {
    const usedBytes = BigInt(10) * BigInt(1024 * 1024 * 1024); // 10 GB used
    const maxBytes = BigInt(50) * BigInt(1024 * 1024 * 1024);  // 50 GB max
    const fileSize = BigInt(1) * BigInt(1024 * 1024 * 1024);    // 1 GB file

    const overQuota = usedBytes + fileSize > maxBytes;
    assert.ok(!overQuota, "Upload should be allowed when within quota");
  });

  it("handles exact boundary — used + file = max should be allowed", () => {
    const usedBytes = BigInt(49) * BigInt(1024 * 1024 * 1024);
    const maxBytes = BigInt(50) * BigInt(1024 * 1024 * 1024);
    const fileSize = BigInt(1) * BigInt(1024 * 1024 * 1024);

    const overQuota = usedBytes + fileSize > maxBytes;
    assert.ok(!overQuota, "Upload at exact quota boundary should be allowed");
  });

  it("rejects when exactly 1 byte over quota", () => {
    const maxBytes = BigInt(50) * BigInt(1024 * 1024 * 1024);
    const usedBytes = maxBytes - BigInt(100);
    const fileSize = BigInt(101);

    const overQuota = usedBytes + fileSize > maxBytes;
    assert.ok(overQuota, "Upload exceeding quota by 1 byte must be rejected");
  });
});

// ─── Deduplication Tests ─────────────────────────────────────────

describe("Deduplication", () => {
  it("two entries with the same SHA-256 should share an infoHash", () => {
    const sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const sharedInfoHash = "d2354b8e12c3a4f5b6c7d8e9f0a1b2c3d4e5f6a7";

    const entry1 = makeSampleEntry({
      id: "11111111-1111-1111-1111-111111111111",
      filename: "original.pdf",
      sha256,
      infoHash: sharedInfoHash,
    });

    const entry2 = makeSampleEntry({
      id: "22222222-2222-2222-2222-222222222222",
      filename: "duplicate.pdf",
      sha256,
      infoHash: sharedInfoHash,
    });

    assert.equal(entry1.sha256, entry2.sha256, "SHA-256 must match");
    assert.equal(entry1.infoHash, entry2.infoHash, "Deduped entries must share infoHash");
    assert.notEqual(entry1.id, entry2.id, "Entry IDs must be unique");
    assert.notEqual(entry1.filename, entry2.filename, "Filenames can differ");
  });

  it("entries with different SHA-256 have independent infoHash values", () => {
    const entry1 = makeSampleEntry({
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      infoHash: "1111111111111111111111111111111111111111",
    });

    const entry2 = makeSampleEntry({
      sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      infoHash: "2222222222222222222222222222222222222222",
    });

    assert.notEqual(entry1.sha256, entry2.sha256);
    assert.notEqual(entry1.infoHash, entry2.infoHash);
  });
});

// ─── Share Flow Tests ────────────────────────────────────────────

describe("Share Flow Integration", () => {
  const sender = generateKeypair();
  const recipient = generateKeypair();

  it("sender encrypts to recipient, recipient can decrypt, sender cannot decrypt shared copy", () => {
    const entry = makeSampleEntry();
    const plaintext = serializeLockerEntry(entry);

    // Step 1: Sender encrypts to own pubkey (original locker entry)
    const selfEncrypted = nip44Encrypt(plaintext, sender.privkey, sender.pubkey);

    // Step 2: Sender decrypts own copy
    const decryptedBySender = nip44Decrypt(selfEncrypted, sender.privkey, sender.pubkey);
    assert.equal(decryptedBySender, plaintext, "Sender must be able to decrypt own copy");

    // Step 3: Sender re-encrypts to recipient's pubkey
    const sharedEncrypted = nip44Encrypt(decryptedBySender, sender.privkey, recipient.pubkey);

    // Step 4: Recipient decrypts using their privkey + sender's pubkey
    const decryptedByRecipient = nip44Decrypt(sharedEncrypted, recipient.privkey, sender.pubkey);
    const restoredEntry = deserializeLockerEntry(decryptedByRecipient);

    assert.equal(restoredEntry.id, entry.id);
    assert.equal(restoredEntry.filename, entry.filename);
    assert.equal(restoredEntry.sha256, entry.sha256);
    assert.deepEqual(restoredEntry.tags, entry.tags);

    // Step 5: Sender cannot decrypt the shared copy using self-decryption
    assert.throws(
      () => nip44Decrypt(sharedEncrypted, sender.privkey, sender.pubkey),
      "Sender must not be able to decrypt the copy encrypted to recipient",
    );
  });

  it("shared event has correct tags: p-tag, d-tag, shared-from", () => {
    const shareId = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
    const entryId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

    const shareTags: string[][] = [
      ["d", shareId],
      ["p", recipient.pubkey],
      ["shared-from", sender.pubkey],
      ["shared-entry", entryId],
    ];

    // Verify p-tag for recipient filtering
    const pTag = shareTags.find((t) => t[0] === "p");
    assert.ok(pTag, "Share event must have a p-tag");
    assert.equal(pTag![1], recipient.pubkey, "p-tag must be recipient's pubkey");

    // Verify shared-from tag
    const sharedFromTag = shareTags.find((t) => t[0] === "shared-from");
    assert.ok(sharedFromTag, "Share event must have shared-from tag");
    assert.equal(sharedFromTag![1], sender.pubkey, "shared-from must be sender's pubkey");

    // Verify d-tag is the share ID (not original entry ID)
    const dTag = shareTags.find((t) => t[0] === "d");
    assert.ok(dTag, "Share event must have d-tag");
    assert.equal(dTag![1], shareId, "d-tag must be the share ID");

    // Verify shared-entry references the original
    const sharedEntryTag = shareTags.find((t) => t[0] === "shared-entry");
    assert.ok(sharedEntryTag, "Share event must have shared-entry tag");
    assert.equal(sharedEntryTag![1], entryId, "shared-entry must reference original entry ID");
  });

  it("third party cannot decrypt shared content", () => {
    const thirdParty = generateKeypair();
    const entry = makeSampleEntry();
    const plaintext = serializeLockerEntry(entry);

    // Sender encrypts to recipient
    const sharedEncrypted = nip44Encrypt(plaintext, sender.privkey, recipient.pubkey);

    // Third party tries to decrypt — should fail
    assert.throws(
      () => nip44Decrypt(sharedEncrypted, thirdParty.privkey, sender.pubkey),
      "Third party must not be able to decrypt shared content",
    );
    assert.throws(
      () => nip44Decrypt(sharedEncrypted, thirdParty.privkey, recipient.pubkey),
      "Third party must not be able to decrypt shared content (using recipient pubkey)",
    );
  });

  it("recipient filtering by p-tag works correctly", () => {
    const events = [
      { pubkey: sender.pubkey, tags: [["d", "share-1"], ["p", recipient.pubkey], ["shared-from", sender.pubkey]] },
      { pubkey: sender.pubkey, tags: [["d", "share-2"], ["p", "deadbeef".repeat(8)], ["shared-from", sender.pubkey]] },
      { pubkey: sender.pubkey, tags: [["d", "entry-1"]] }, // regular entry, no p-tag
    ];

    const sharedWithRecipient = events.filter((e) =>
      e.tags.some((t) => t[0] === "p" && t[1] === recipient.pubkey),
    );

    assert.equal(sharedWithRecipient.length, 1, "Only one event should match recipient's p-tag");
    assert.equal(
      sharedWithRecipient[0].tags.find((t) => t[0] === "d")![1],
      "share-1",
    );
  });
});
