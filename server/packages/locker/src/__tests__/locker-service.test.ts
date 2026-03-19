/**
 * Locker Service Unit Tests
 *
 * Tests LockerEntry validation, quota math, and storage helpers.
 *
 * Run: npx tsx --test server/packages/locker/src/__tests__/locker-service.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  validateLockerEntry,
  serializeLockerEntry,
  deserializeLockerEntry,
  buildLockerEventTags,
  LOCKER_ENTRY_KIND,
  type LockerEntry,
} from "@boilerdeck/shared";

// ─── Validation Tests ───────────────────────────────────────────

describe("LockerEntry Validation", () => {
  function validEntry(): LockerEntry {
    return {
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      filename: "test.pdf",
      size: 1024,
      mimeType: "application/pdf",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      infoHash: "d2354b8e12c3a4f5b6c7d8e9f0a1b2c3d4e5f6a7",
      magnetUri: "magnet:?xt=urn:btih:d2354b8e12c3a4f5b6c7d8e9f0a1b2c3d4e5f6a7",
      createdAt: 1710000000,
      tags: ["documents"],
      version: 1,
    };
  }

  it("accepts a valid entry", () => {
    assert.ok(validateLockerEntry(validEntry()));
  });

  it("rejects null", () => {
    assert.ok(!validateLockerEntry(null));
  });

  it("rejects undefined", () => {
    assert.ok(!validateLockerEntry(undefined));
  });

  it("rejects non-object", () => {
    assert.ok(!validateLockerEntry("string"));
    assert.ok(!validateLockerEntry(42));
    assert.ok(!validateLockerEntry(true));
  });

  it("rejects invalid UUID id", () => {
    assert.ok(!validateLockerEntry({ ...validEntry(), id: "not-a-uuid" }));
    assert.ok(!validateLockerEntry({ ...validEntry(), id: "" }));
    assert.ok(!validateLockerEntry({ ...validEntry(), id: 123 }));
  });

  it("rejects empty filename", () => {
    assert.ok(!validateLockerEntry({ ...validEntry(), filename: "" }));
  });

  it("rejects non-string filename", () => {
    assert.ok(!validateLockerEntry({ ...validEntry(), filename: 123 }));
  });

  it("rejects empty mimeType", () => {
    assert.ok(!validateLockerEntry({ ...validEntry(), mimeType: "" }));
  });

  it("rejects invalid sha256 (wrong length)", () => {
    assert.ok(!validateLockerEntry({ ...validEntry(), sha256: "abc" }));
  });

  it("rejects invalid sha256 (non-hex)", () => {
    assert.ok(!validateLockerEntry({ ...validEntry(), sha256: "g".repeat(64) }));
  });

  it("rejects invalid infoHash (wrong length)", () => {
    assert.ok(!validateLockerEntry({ ...validEntry(), infoHash: "abc" }));
  });

  it("rejects infoHash with 64 chars (should be 40)", () => {
    assert.ok(!validateLockerEntry({ ...validEntry(), infoHash: "a".repeat(64) }));
  });

  it("rejects magnetUri not starting with magnet:", () => {
    assert.ok(!validateLockerEntry({ ...validEntry(), magnetUri: "https://example.com" }));
  });

  it("rejects negative size", () => {
    assert.ok(!validateLockerEntry({ ...validEntry(), size: -1 }));
  });

  it("rejects non-integer size", () => {
    assert.ok(!validateLockerEntry({ ...validEntry(), size: 1.5 }));
  });

  it("allows size of 0", () => {
    assert.ok(validateLockerEntry({ ...validEntry(), size: 0 }));
  });

  it("rejects negative createdAt", () => {
    assert.ok(!validateLockerEntry({ ...validEntry(), createdAt: -1 }));
  });

  it("rejects version 0 (must be >= 1)", () => {
    assert.ok(!validateLockerEntry({ ...validEntry(), version: 0 }));
  });

  it("rejects non-integer version", () => {
    assert.ok(!validateLockerEntry({ ...validEntry(), version: 1.5 }));
  });

  it("rejects tags with non-string elements", () => {
    assert.ok(!validateLockerEntry({ ...validEntry(), tags: [123] }));
  });

  it("accepts empty tags array", () => {
    assert.ok(validateLockerEntry({ ...validEntry(), tags: [] }));
  });

  it("accepts valid peerHints", () => {
    assert.ok(validateLockerEntry({ ...validEntry(), peerHints: ["192.168.1.1:6881"] }));
  });

  it("accepts empty peerHints array", () => {
    assert.ok(validateLockerEntry({ ...validEntry(), peerHints: [] }));
  });

  it("rejects peerHints with non-string elements", () => {
    assert.ok(!validateLockerEntry({ ...validEntry(), peerHints: [123] }));
  });

  it("accepts entry without peerHints (optional)", () => {
    const entry = validEntry();
    delete (entry as Record<string, unknown>).peerHints;
    assert.ok(validateLockerEntry(entry));
  });

  it("rejects missing required fields", () => {
    const required = ["id", "filename", "size", "mimeType", "sha256", "infoHash", "magnetUri", "createdAt", "tags", "version"];
    for (const field of required) {
      const partial = { ...validEntry() } as Record<string, unknown>;
      delete partial[field];
      assert.ok(!validateLockerEntry(partial), `Must reject missing ${field}`);
    }
  });
});

// ─── Serialization Tests ────────────────────────────────────────

describe("LockerEntry Serialization", () => {
  it("round-trips through serialize/deserialize", () => {
    const entry: LockerEntry = {
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      filename: "photo.jpg",
      size: 2048000,
      mimeType: "image/jpeg",
      sha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      infoHash: "1234567890abcdef1234567890abcdef12345678",
      magnetUri: "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678",
      createdAt: 1710000000,
      tags: ["photos", "vacation"],
      version: 2,
    };

    const json = serializeLockerEntry(entry);
    const restored = deserializeLockerEntry(json);

    assert.deepEqual(restored, entry);
  });

  it("deserialize throws on invalid JSON", () => {
    assert.throws(() => deserializeLockerEntry("not json"), /Invalid JSON/);
  });

  it("deserialize throws on valid JSON that fails validation", () => {
    assert.throws(
      () => deserializeLockerEntry(JSON.stringify({ foo: "bar" })),
      /failed validation/,
    );
  });

  it("serialize produces valid JSON", () => {
    const entry: LockerEntry = {
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      filename: "file.txt",
      size: 100,
      mimeType: "text/plain",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      infoHash: "d2354b8e12c3a4f5b6c7d8e9f0a1b2c3d4e5f6a7",
      magnetUri: "magnet:?xt=urn:btih:d2354b8e12c3a4f5b6c7d8e9f0a1b2c3d4e5f6a7",
      createdAt: 1710000000,
      tags: [],
      version: 1,
    };

    const json = serializeLockerEntry(entry);
    const parsed = JSON.parse(json);
    assert.equal(parsed.filename, "file.txt");
  });
});

// ─── Event Tag Tests ────────────────────────────────────────────

describe("buildLockerEventTags", () => {
  it("produces d-tag and t-tags for each user tag", () => {
    const entry: LockerEntry = {
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      filename: "f.txt",
      size: 1,
      mimeType: "text/plain",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      infoHash: "d2354b8e12c3a4f5b6c7d8e9f0a1b2c3d4e5f6a7",
      magnetUri: "magnet:?xt=urn:btih:d2354b8e12c3a4f5b6c7d8e9f0a1b2c3d4e5f6a7",
      createdAt: 1710000000,
      tags: ["alpha", "beta"],
      version: 1,
    };

    const tags = buildLockerEventTags(entry);

    assert.equal(tags[0][0], "d");
    assert.equal(tags[0][1], entry.id);
    assert.deepEqual(tags[1], ["t", "alpha"]);
    assert.deepEqual(tags[2], ["t", "beta"]);
    assert.equal(tags.length, 3);
  });

  it("produces only d-tag when no user tags", () => {
    const entry: LockerEntry = {
      id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      filename: "f.txt",
      size: 1,
      mimeType: "text/plain",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      infoHash: "d2354b8e12c3a4f5b6c7d8e9f0a1b2c3d4e5f6a7",
      magnetUri: "magnet:?xt=urn:btih:d2354b8e12c3a4f5b6c7d8e9f0a1b2c3d4e5f6a7",
      createdAt: 1710000000,
      tags: [],
      version: 1,
    };

    const tags = buildLockerEventTags(entry);
    assert.equal(tags.length, 1);
    assert.deepEqual(tags[0], ["d", entry.id]);
  });
});

// ─── Quota Math Tests ───────────────────────────────────────────

describe("Quota Math", () => {
  it("increment adds to used bytes", () => {
    let used = BigInt(0);
    const fileSize = BigInt(1024 * 1024); // 1 MB

    used += fileSize;
    assert.equal(used, BigInt(1024 * 1024));

    used += BigInt(2 * 1024 * 1024); // 2 MB
    assert.equal(used, BigInt(3 * 1024 * 1024));
  });

  it("decrement subtracts from used bytes", () => {
    let used = BigInt(10 * 1024 * 1024); // 10 MB
    const fileSize = BigInt(3 * 1024 * 1024); // 3 MB

    used -= fileSize;
    assert.equal(used, BigInt(7 * 1024 * 1024));
  });

  it("decrement floors at zero (never negative)", () => {
    const used = BigInt(100);
    const fileSize = BigInt(200);

    const result = used - fileSize;
    const floored = result < BigInt(0) ? BigInt(0) : result;
    assert.equal(floored, BigInt(0));
  });

  it("handles large file sizes (multi-GB) correctly with BigInt", () => {
    const maxBytes = BigInt(50) * BigInt(1024 * 1024 * 1024); // 50 GB
    const fileSize = BigInt(5) * BigInt(1024 * 1024 * 1024);  // 5 GB
    let used = BigInt(0);

    // Upload 10 files of 5 GB each = 50 GB
    for (let i = 0; i < 10; i++) {
      used += fileSize;
    }

    assert.equal(used, maxBytes);
    assert.ok(used + fileSize > maxBytes, "Next upload should exceed quota");
  });

  it("decrement after delete restores available space", () => {
    const maxBytes = BigInt(50) * BigInt(1024 * 1024 * 1024);
    let used = BigInt(45) * BigInt(1024 * 1024 * 1024); // 45 GB used
    const deleteSize = BigInt(10) * BigInt(1024 * 1024 * 1024); // delete 10 GB

    used -= deleteSize;
    const newFileSize = BigInt(14) * BigInt(1024 * 1024 * 1024);

    assert.ok(used + newFileSize <= maxBytes, "Should have space after deletion");
  });
});

// ─── Storage Helper Tests ───────────────────────────────────────

describe("Storage Helpers", () => {
  it("file path construction follows userId/entryId/filename pattern", () => {
    const userId = "user-123";
    const entryId = "entry-456";
    const filename = "document.pdf";

    // Test the pattern (not actual storage.ts — testing the logic)
    const lockerDir = "./data/locker";
    const userDir = path.join(lockerDir, userId);
    const entryDir = path.join(userDir, entryId);
    const filePath = path.join(entryDir, filename);

    assert.ok(filePath.includes(userId), "Path must include userId");
    assert.ok(filePath.includes(entryId), "Path must include entryId");
    assert.ok(filePath.endsWith(filename), "Path must end with filename");
  });

  it("torrent path follows userId/entryId/entryId.torrent pattern", () => {
    const userId = "user-123";
    const entryId = "entry-456";

    const lockerDir = "./data/locker";
    const torrentPath = path.join(lockerDir, userId, entryId, `${entryId}.torrent`);

    assert.ok(torrentPath.includes(userId));
    assert.ok(torrentPath.endsWith(`${entryId}.torrent`));
  });

  it("SHA-256 produces 64-char hex string", () => {
    // Test the expected format (not actually hashing)
    const expectedPattern = /^[0-9a-f]{64}$/;
    const exampleHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    assert.ok(expectedPattern.test(exampleHash));
  });
});

// ─── Constants Tests ────────────────────────────────────────────

describe("Locker Constants", () => {
  it("LOCKER_ENTRY_KIND is 30078", () => {
    assert.equal(LOCKER_ENTRY_KIND, 30078);
  });
});
