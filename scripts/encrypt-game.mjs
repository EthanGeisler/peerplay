#!/usr/bin/env node
/**
 * Encrypt game files for Peerplay ENCRYPTED DRM tier.
 *
 * Usage: node scripts/encrypt-game.mjs <input-dir> <output-dir>
 *
 * Requires DRM_MASTER_KEK env var (64+ hex chars).
 * Outputs wrapped master key hex for use with publish-game-encrypted.mjs.
 */
import { createReadStream, createWriteStream, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createCipheriv, randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";

function wrapKey(key, kek) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

const inputDir = process.argv[2];
const outputDir = process.argv[3];

if (!inputDir || !outputDir) {
  console.error("Usage: node scripts/encrypt-game.mjs <input-dir> <output-dir>");
  process.exit(1);
}

const kekHex = process.env.DRM_MASTER_KEK;
if (!kekHex || kekHex.length < 64) {
  console.error("Error: DRM_MASTER_KEK env var must be at least 64 hex characters");
  process.exit(1);
}

const kek = Buffer.from(kekHex, "hex");
const masterKey = randomBytes(32);
const iv = randomBytes(16);

console.log("Encrypting game files...");
console.log(`  Algorithm: aes-256-ctr`);
console.log(`  IV: ${iv.toString("hex")}`);

function collectFiles(dir) {
  const entries = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...collectFiles(fullPath));
    } else {
      entries.push(fullPath);
    }
  }
  return entries;
}

const files = collectFiles(inputDir);
let fileCount = 0;

for (const filePath of files) {
  const rel = relative(inputDir, filePath);
  const outPath = join(outputDir, rel);

  mkdirSync(join(outPath, ".."), { recursive: true });

  const cipher = createCipheriv("aes-256-ctr", masterKey, iv);
  await pipeline(
    createReadStream(filePath),
    cipher,
    createWriteStream(outPath),
  );
  fileCount++;
  console.log(`  Encrypted: ${rel}`);
}

// Write manifest
const manifest = {
  algorithm: "aes-256-ctr",
  iv: iv.toString("hex"),
  fileCount,
};
writeFileSync(
  join(outputDir, "_peerplay_manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(`\nManifest written: _peerplay_manifest.json`);

// Wrap master key with KEK
const wrappedMasterKey = wrapKey(masterKey, kek);
const wrappedHex = wrappedMasterKey.toString("hex");

console.log(`\nEncryption complete!`);
console.log(`  Files encrypted: ${fileCount}`);
console.log(`  Wrapped master key (use with publish-game-encrypted.mjs):`);
console.log(`  ${wrappedHex}`);
