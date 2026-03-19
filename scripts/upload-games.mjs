#!/usr/bin/env node

/**
 * Upload games to BoilerDeck from a manifest file.
 *
 * Usage:
 *   node scripts/upload-games.mjs <email> <password> [manifest.json]
 *
 * The manifest defaults to game-staging/manifest.json if not specified.
 *
 * Manifest format (JSON array):
 * [
 *   {
 *     "zipFile": "openttd.zip",        // Filename in game-staging/
 *     "coverFile": "covers/openttd.png", // Optional, relative to game-staging/
 *     "title": "OpenTTD",
 *     "description": "...",
 *     "version": "15.2.0",             // Must be semver (X.Y.Z)
 *     "priceCents": 0,
 *     "contentType": "GAME"            // Optional: GAME (default), VIDEO, SOFTWARE, AUDIO, OTHER
 *   }
 * ]
 *
 * For each game, the script will:
 *   1. Create the game entry (POST /developer/games)
 *   2. Create a version (POST /developer/games/:id/versions)
 *   3. Upload the zip (POST /developer/games/:id/versions/:vid/upload)
 *   4. Upload cover image if coverFile is set (POST /developer/games/:id/cover)
 *   5. Publish the game (PATCH /developer/games/:id/publish)
 *
 * IMPORTANT: The Bash tool cannot handle interactive prompts, so credentials
 * must be passed as CLI args. Tell the user to run this command themselves:
 *   node scripts/upload-games.mjs their@email.com theirpassword
 *
 * After uploading, you MUST re-seed torrents in Transmission on the VPS.
 * The upload pipeline's addToTransmission() is fire-and-forget and often
 * fails silently for large torrent files. Use the re-seeding script:
 *   ssh root@204.168.133.38 'bash -s' < scripts/reseed-torrents.sh
 *
 * Requires: Node 18+ (for native fetch)
 */

import fs from "node:fs";
import path from "node:path";

const API = "https://boilerdeck.com/api";
const STAGING_DIR = path.resolve(import.meta.dirname, "../game-staging");

// ── Helpers ───────────────────────────────────────────────────────────────────

let accessToken = null;

async function apiFetch(endpoint, opts = {}) {
  const res = await fetch(`${API}${endpoint}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      ...(opts.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let msg;
    try { msg = JSON.parse(text).error?.message || JSON.parse(text).message || text; } catch { msg = text; }
    throw new Error(`${res.status} ${res.statusText}: ${msg}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function login(email, password) {
  const data = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  accessToken = data.accessToken;
  console.log(`✓ Logged in as ${data.user.displayName} (${data.user.role})`);
  if (data.user.role !== "DEVELOPER" && data.user.role !== "ADMIN") {
    throw new Error("Account must have DEVELOPER or ADMIN role to upload games.");
  }
}

async function uploadFile(url, fieldName, filePath, mimeType) {
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: mimeType });
  const formData = new FormData();
  formData.append(fieldName, blob, path.basename(filePath));

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed: ${res.status} ${text}`);
  }
  return res.json();
}

const MIME_MAP = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".webp": "image/webp",
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== BoilerDeck Game Uploader ===\n");

  const email = process.argv[2];
  const password = process.argv[3];
  const manifestPath = process.argv[4]
    ? path.resolve(process.argv[4])
    : path.join(STAGING_DIR, "manifest.json");

  if (!email || !password) {
    console.error("Usage: node scripts/upload-games.mjs <email> <password> [manifest.json]");
    process.exit(1);
  }

  if (!fs.existsSync(manifestPath)) {
    console.error(`Manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  const games = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  console.log(`Loaded ${games.length} games from ${path.basename(manifestPath)}\n`);

  // Verify all zips exist before starting
  for (const game of games) {
    const zipPath = path.join(STAGING_DIR, game.zipFile);
    if (!fs.existsSync(zipPath)) {
      console.error(`Missing zip: ${zipPath}`);
      process.exit(1);
    }
  }

  await login(email, password);
  console.log();

  let success = 0;
  for (const game of games) {
    const zipPath = path.join(STAGING_DIR, game.zipFile);
    const sizeMB = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(0);
    console.log(`── ${game.title} (${sizeMB} MB) ──`);

    try {
      // 1. Create listing
      console.log("  Creating listing entry...");
      const createBody = {
        title: game.title,
        description: game.description,
        priceCents: game.priceCents,
      };
      if (game.contentType) createBody.contentType = game.contentType;
      const created = await apiFetch("/developer/listings", {
        method: "POST",
        body: JSON.stringify(createBody),
      });
      console.log(`  ✓ Listing created: ${created.slug}`);

      // 2. Create version
      console.log(`  Creating version ${game.version}...`);
      const version = await apiFetch(`/developer/listings/${created.id}/versions`, {
        method: "POST",
        body: JSON.stringify({ version: game.version }),
      });
      console.log(`  ✓ Version created: ${version.id}`);

      // 3. Upload zip
      await uploadFile(
        `${API}/developer/listings/${created.id}/versions/${version.id}/upload`,
        "gameZip", zipPath, "application/zip"
      );
      console.log(`  ✓ Zip uploaded & processed`);

      // 4. Upload cover image (optional)
      if (game.coverFile) {
        const coverPath = path.join(STAGING_DIR, game.coverFile);
        if (fs.existsSync(coverPath)) {
          const ext = path.extname(coverPath).toLowerCase();
          const mime = MIME_MAP[ext] || "application/octet-stream";
          await uploadFile(
            `${API}/developer/listings/${created.id}/cover`,
            "cover", coverPath, mime
          );
          console.log(`  ✓ Cover uploaded`);
        } else {
          console.log(`  ⚠ Cover file not found: ${game.coverFile}`);
        }
      }

      // 5. Publish
      await apiFetch(`/developer/listings/${created.id}/publish`, { method: "PATCH" });
      console.log(`  ✓ Published!`);
      success++;
    } catch (err) {
      console.error(`  ✗ FAILED: ${err.message}`);
    }
    console.log();
  }

  console.log(`=== Done: ${success}/${games.length} listings uploaded ===`);
  if (success > 0) {
    console.log(`\n⚠ IMPORTANT: Re-seed torrents on VPS! Run:`);
    console.log(`  ssh root@204.168.133.38 'bash -s' < scripts/reseed-torrents.sh`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
