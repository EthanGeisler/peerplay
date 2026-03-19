import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LOCKER_ENTRY_KIND,
  validateLockerEntry,
  serializeLockerEntry,
  deserializeLockerEntry,
  buildLockerEventTags,
} from "../locker.js";
import type { LockerEntry } from "../locker.js";

// ─── Fixture ────────────────────────────────────────────────────────

function makeValidEntry(overrides?: Partial<LockerEntry>): LockerEntry {
  return {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    filename: "report.pdf",
    size: 1048576,
    mimeType: "application/pdf",
    sha256:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    infoHash: "abcdef1234567890abcdef1234567890abcdef12",
    magnetUri:
      "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12&dn=report.pdf",
    createdAt: 1710700000,
    tags: ["documents", "work"],
    version: 1,
    ...overrides,
  };
}

// ─── Constants ──────────────────────────────────────────────────────

describe("LOCKER_ENTRY_KIND", () => {
  it("equals 30078", () => {
    assert.equal(LOCKER_ENTRY_KIND, 30078);
  });
});

// ─── Serialization round-trip ───────────────────────────────────────

describe("serializeLockerEntry / deserializeLockerEntry", () => {
  it("round-trips a valid entry", () => {
    const entry = makeValidEntry();
    const json = serializeLockerEntry(entry);
    const restored = deserializeLockerEntry(json);
    assert.deepStrictEqual(restored, entry);
  });

  it("round-trips an entry with no tags", () => {
    const entry = makeValidEntry({ tags: [] });
    const json = serializeLockerEntry(entry);
    const restored = deserializeLockerEntry(json);
    assert.deepStrictEqual(restored, entry);
  });

  it("produces valid JSON", () => {
    const entry = makeValidEntry();
    const json = serializeLockerEntry(entry);
    assert.doesNotThrow(() => JSON.parse(json));
  });

  it("throws on invalid JSON", () => {
    assert.throws(
      () => deserializeLockerEntry("not json"),
      /Invalid JSON for LockerEntry/,
    );
  });

  it("throws on valid JSON that fails validation", () => {
    assert.throws(
      () => deserializeLockerEntry(JSON.stringify({ foo: "bar" })),
      /Invalid LockerEntry: failed validation/,
    );
  });
});

// ─── Validation: valid entry ────────────────────────────────────────

describe("validateLockerEntry — valid entries", () => {
  it("accepts a valid entry", () => {
    assert.equal(validateLockerEntry(makeValidEntry()), true);
  });

  it("accepts version > 1", () => {
    assert.equal(validateLockerEntry(makeValidEntry({ version: 5 })), true);
  });

  it("accepts size = 0", () => {
    assert.equal(validateLockerEntry(makeValidEntry({ size: 0 })), true);
  });

  it("accepts createdAt = 0", () => {
    assert.equal(validateLockerEntry(makeValidEntry({ createdAt: 0 })), true);
  });
});

// ─── Validation: missing fields ─────────────────────────────────────

describe("validateLockerEntry — missing fields", () => {
  const requiredFields: (keyof LockerEntry)[] = [
    "id",
    "filename",
    "size",
    "mimeType",
    "sha256",
    "infoHash",
    "magnetUri",
    "createdAt",
    "tags",
    "version",
  ];

  for (const field of requiredFields) {
    it(`rejects when ${field} is missing`, () => {
      const entry = makeValidEntry();
      delete (entry as Record<string, unknown>)[field];
      assert.equal(validateLockerEntry(entry), false);
    });
  }
});

// ─── Validation: wrong types ────────────────────────────────────────

describe("validateLockerEntry — wrong types", () => {
  it("rejects null", () => {
    assert.equal(validateLockerEntry(null), false);
  });

  it("rejects non-object", () => {
    assert.equal(validateLockerEntry("string"), false);
    assert.equal(validateLockerEntry(42), false);
  });

  it("rejects non-UUID id", () => {
    assert.equal(
      validateLockerEntry(makeValidEntry({ id: "not-a-uuid" })),
      false,
    );
  });

  it("rejects empty filename", () => {
    assert.equal(
      validateLockerEntry(makeValidEntry({ filename: "" })),
      false,
    );
  });

  it("rejects empty mimeType", () => {
    assert.equal(
      validateLockerEntry(makeValidEntry({ mimeType: "" })),
      false,
    );
  });

  it("rejects bad sha256 (wrong length)", () => {
    assert.equal(
      validateLockerEntry(makeValidEntry({ sha256: "abc" })),
      false,
    );
  });

  it("rejects bad infoHash (wrong length)", () => {
    assert.equal(
      validateLockerEntry(makeValidEntry({ infoHash: "tooshort" })),
      false,
    );
  });

  it("rejects magnetUri that does not start with magnet:", () => {
    assert.equal(
      validateLockerEntry(
        makeValidEntry({ magnetUri: "http://example.com" }),
      ),
      false,
    );
  });

  it("rejects negative size", () => {
    assert.equal(
      validateLockerEntry(makeValidEntry({ size: -1 })),
      false,
    );
  });

  it("rejects non-integer size", () => {
    assert.equal(
      validateLockerEntry(makeValidEntry({ size: 1.5 })),
      false,
    );
  });

  it("rejects negative createdAt", () => {
    assert.equal(
      validateLockerEntry(makeValidEntry({ createdAt: -1 })),
      false,
    );
  });

  it("rejects version < 1", () => {
    assert.equal(
      validateLockerEntry(makeValidEntry({ version: 0 })),
      false,
    );
  });

  it("rejects tags with non-string elements", () => {
    const entry = makeValidEntry();
    (entry as Record<string, unknown>).tags = ["valid", 123];
    assert.equal(validateLockerEntry(entry), false);
  });

  it("rejects tags as non-array", () => {
    const entry = makeValidEntry();
    (entry as Record<string, unknown>).tags = "not-array";
    assert.equal(validateLockerEntry(entry), false);
  });
});

// ─── buildLockerEventTags ───────────────────────────────────────────

describe("buildLockerEventTags", () => {
  it("includes d tag with entry id", () => {
    const entry = makeValidEntry();
    const tags = buildLockerEventTags(entry);
    assert.deepStrictEqual(tags[0], ["d", entry.id]);
  });

  it("includes t tags for each user tag", () => {
    const entry = makeValidEntry({ tags: ["photos", "vacation"] });
    const tags = buildLockerEventTags(entry);
    assert.equal(tags.length, 3); // d + 2 t tags
    assert.deepStrictEqual(tags[1], ["t", "photos"]);
    assert.deepStrictEqual(tags[2], ["t", "vacation"]);
  });

  it("returns only d tag when entry has no user tags", () => {
    const entry = makeValidEntry({ tags: [] });
    const tags = buildLockerEventTags(entry);
    assert.equal(tags.length, 1);
    assert.deepStrictEqual(tags[0], ["d", entry.id]);
  });
});
