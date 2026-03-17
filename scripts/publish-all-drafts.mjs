#!/usr/bin/env node

/**
 * Publish all DRAFT games on BoilerDeck.
 *
 * Usage:
 *   node scripts/publish-all-drafts.mjs <email> <password>
 */

const API = "https://boilerdeck.com/api";

let accessToken = null;

async function apiFetch(endpoint, opts = {}) {
  const res = await fetch(`${API}${endpoint}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      "Content-Type": "application/json",
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

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) {
    console.error("Usage: node scripts/publish-all-drafts.mjs <email> <password>");
    process.exit(1);
  }

  // Login
  const auth = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  accessToken = auth.accessToken;
  console.log(`Logged in as ${auth.user.displayName}\n`);

  // Get developer's games (the developer games endpoint returns all, including drafts)
  const res = await fetch(`${API}/developer/games`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch developer games: ${res.status}`);
  const data = await res.json();
  const games = data.games || data;

  let published = 0;
  for (const game of games) {
    if (game.status === "DRAFT") {
      console.log(`Publishing "${game.title}" (${game.id})...`);
      try {
        await apiFetch(`/developer/games/${game.id}/publish`, { method: "PATCH" });
        console.log(`  ✓ Published!`);
        published++;
      } catch (err) {
        console.error(`  ✗ Failed: ${err.message}`);
      }
    } else {
      console.log(`"${game.title}" — already ${game.status}`);
    }
  }

  console.log(`\nDone: ${published} games published.`);
}

main().catch((err) => { console.error("Fatal:", err.message); process.exit(1); });
