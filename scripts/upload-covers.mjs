#!/usr/bin/env node

/**
 * Upload cover images for games on BoilerDeck.
 *
 * Usage:
 *   node scripts/upload-covers.mjs <email> <password>
 */

import fs from "node:fs";
import path from "node:path";

const API = "https://boilerdeck.com/api";
const COVERS_DIR = path.resolve(import.meta.dirname, "../game-staging/covers");

// Map game title substring → cover image filename
const COVER_MAP = [
  { match: "OpenTTD", file: "openttd.png" },
  { match: "OpenRA", file: "openra.webp" },
  { match: "Endless Sky", file: "endless-sky.jpg" },
  { match: "Warzone 2100", file: "warzone2100.png" },
  { match: "Veloren", file: "veloren.webp" },
  { match: "SuperTuxKart", file: "supertuxkart.jpg" },
];

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
    throw new Error(`${res.status}: ${msg}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

const MIME_MAP = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

async function uploadCover(gameId, imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  const mime = MIME_MAP[ext] || "application/octet-stream";
  const fileBuffer = fs.readFileSync(imagePath);
  const blob = new Blob([fileBuffer], { type: mime });

  const formData = new FormData();
  formData.append("cover", blob, path.basename(imagePath));

  const res = await fetch(`${API}/developer/games/${gameId}/cover`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) {
    console.error("Usage: node scripts/upload-covers.mjs <email> <password>");
    process.exit(1);
  }

  // Login
  const auth = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  accessToken = auth.accessToken;
  console.log(`Logged in as ${auth.user.displayName}\n`);

  // Get developer's games
  const res = await fetch(`${API}/developer/games`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch games: ${res.status}`);
  const data = await res.json();
  const games = data.games || data;

  let uploaded = 0;
  for (const game of games) {
    // Find matching cover
    const mapping = COVER_MAP.find((m) => game.title.includes(m.match));
    if (!mapping) {
      console.log(`"${game.title}" — no cover image mapped, skipping`);
      continue;
    }

    // Skip if already has a cover and it's a published duplicate (DRAFT)
    if (game.status === "DRAFT") {
      console.log(`"${game.title}" — DRAFT, skipping`);
      continue;
    }

    const imagePath = path.join(COVERS_DIR, mapping.file);
    if (!fs.existsSync(imagePath)) {
      console.log(`"${game.title}" — cover file not found: ${mapping.file}, skipping`);
      continue;
    }

    const sizeMB = (fs.statSync(imagePath).size / 1024).toFixed(0);
    console.log(`Uploading cover for "${game.title}" (${mapping.file}, ${sizeMB} KB)...`);
    try {
      await uploadCover(game.id, imagePath);
      console.log(`  ✓ Done!`);
      uploaded++;
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
    }
  }

  console.log(`\n${uploaded} covers uploaded.`);
}

main().catch((err) => { console.error("Fatal:", err.message); process.exit(1); });
