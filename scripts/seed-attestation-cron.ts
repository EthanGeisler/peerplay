#!/usr/bin/env npx tsx
/**
 * VPS Seed Box Attestation Script
 *
 * Publishes kind 31338 attestation events for games seeded by the VPS
 * Transmission daemon. Runs on the VPS via cron or manually.
 *
 * Usage:
 *   VPS_SEED_PRIVKEY=<64-char-hex> npx tsx scripts/seed-attestation-cron.ts
 *
 * The script:
 * 1. Derives the seed box pubkey from VPS_SEED_PRIVKEY
 * 2. Queries Transmission RPC for torrents with upload data
 * 3. For each torrent, looks up the game developer's pubkey via DB
 * 4. Creates and signs kind 31338 attestation events
 * 5. Stores events directly via the event store (no REST API auth needed)
 *
 * Idempotent: kind 31338 is parameterized replaceable (pubkey + kind + dTag).
 * Running the script twice replaces attestations with updated stats.
 */

import { schnorr } from "@noble/curves/secp256k1.js";
import {
  db,
  createEvent,
  verifyEvent,
  storeEvent,
  EVENT_KIND_ATTESTATION,
} from "@boilerdeck/shared";

// ─── Types ──────────────────────────────────────────────────────────

interface TransmissionTorrent {
  hashString: string;
  uploadedEver: number;
  addedDate: number;
  name: string;
}

interface TransmissionResponse {
  result: string;
  arguments: {
    torrents: TransmissionTorrent[];
  };
}

// ─── Configuration ──────────────────────────────────────────────────

const TRANSMISSION_RPC_URL =
  process.env.TRANSMISSION_RPC_URL || "http://127.0.0.1:9091/transmission/rpc";

// ─── Transmission RPC ───────────────────────────────────────────────

/**
 * Get a Transmission session ID via the CSRF dance.
 * First request returns 409 with X-Transmission-Session-Id header.
 */
async function getTransmissionSessionId(): Promise<string> {
  const response = await fetch(TRANSMISSION_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "session-get" }),
  });

  // 409 is expected — grab the session ID header
  if (response.status === 409) {
    const sessionId = response.headers.get("x-transmission-session-id");
    if (!sessionId) {
      throw new Error(
        "Transmission returned 409 but no X-Transmission-Session-Id header",
      );
    }
    return sessionId;
  }

  // If we got 200, the session ID might be in the header anyway
  const sessionId = response.headers.get("x-transmission-session-id");
  if (sessionId) return sessionId;

  throw new Error(
    `Unexpected Transmission response: ${response.status} ${response.statusText}`,
  );
}

/**
 * Query Transmission RPC for all torrents with transfer stats.
 */
async function getTransmissionTorrents(): Promise<TransmissionTorrent[]> {
  const sessionId = await getTransmissionSessionId();

  const response = await fetch(TRANSMISSION_RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Transmission-Session-Id": sessionId,
    },
    body: JSON.stringify({
      method: "torrent-get",
      arguments: {
        fields: ["hashString", "uploadedEver", "addedDate", "name"],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Transmission RPC error: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as TransmissionResponse;
  if (data.result !== "success") {
    throw new Error(`Transmission RPC result: ${data.result}`);
  }

  return data.arguments.torrents;
}

// ─── Database Lookups ───────────────────────────────────────────────

/**
 * Look up the developer pubkey for a torrent by infoHash.
 * Chain: Torrent → GameVersion → Game → Developer → User → nostrPubkey
 */
async function getDeveloperPubkeyForTorrent(
  infoHash: string,
): Promise<string | null> {
  const torrent = await db.torrent.findFirst({
    where: { infoHash },
    select: {
      version: {
        select: {
          game: {
            select: {
              developer: {
                select: {
                  user: {
                    select: {
                      nostrPubkey: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  return torrent?.version?.game?.developer?.user?.nostrPubkey ?? null;
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  // 1. Get private key from env and derive pubkey
  const privkeyHex = process.env.VPS_SEED_PRIVKEY;
  if (!privkeyHex) {
    console.error("ERROR: VPS_SEED_PRIVKEY env var is required (64-char hex)");
    process.exit(1);
  }

  if (!/^[0-9a-f]{64}$/i.test(privkeyHex)) {
    console.error("ERROR: VPS_SEED_PRIVKEY must be a 64-character hex string");
    process.exit(1);
  }

  const privkeyBytes = Uint8Array.from(Buffer.from(privkeyHex, "hex"));
  const pubkeyBytes = schnorr.getPublicKey(privkeyBytes);
  const pubkeyHex = Buffer.from(pubkeyBytes).toString("hex");

  console.log(`Seed box pubkey: ${pubkeyHex}`);

  // 2. Query Transmission RPC for torrents
  let torrents: TransmissionTorrent[];
  try {
    torrents = await getTransmissionTorrents();
  } catch (err) {
    console.error(
      "ERROR: Failed to connect to Transmission RPC:",
      err instanceof Error ? err.message : err,
    );
    console.error(
      `  Tried: ${TRANSMISSION_RPC_URL}`,
    );
    console.error("  Is Transmission running?");
    process.exit(1);
  }

  console.log(`Found ${torrents.length} torrents in Transmission`);

  // 3. Filter to torrents that have uploaded data
  const activeTorrents = torrents.filter((t) => t.uploadedEver > 0);
  console.log(
    `${activeTorrents.length} torrents have upload data (bytes uploaded > 0)`,
  );

  if (activeTorrents.length === 0) {
    console.log("Nothing to attest. Exiting.");
    await db.$disconnect();
    return;
  }

  // 4. Create attestation events for each active torrent
  let published = 0;
  let skipped = 0;
  let errors = 0;

  for (const torrent of activeTorrents) {
    const infoHash = torrent.hashString.toLowerCase();
    const bytesUploaded = torrent.uploadedEver;
    const addedDate = torrent.addedDate;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const durationSeconds = nowSeconds - addedDate;

    try {
      // Look up developer pubkey for this torrent
      const developerPubkey = await getDeveloperPubkeyForTorrent(infoHash);
      if (!developerPubkey) {
        console.log(
          `  SKIP ${torrent.name} (${infoHash.slice(0, 8)}...): no developer pubkey found in DB`,
        );
        skipped++;
        continue;
      }

      // Self-attestation guard (shouldn't happen, but be safe)
      if (pubkeyHex.toLowerCase() === developerPubkey.toLowerCase()) {
        console.log(
          `  SKIP ${torrent.name} (${infoHash.slice(0, 8)}...): seed box pubkey matches developer (self-attestation)`,
        );
        skipped++;
        continue;
      }

      // Build the attestation event
      const content = JSON.stringify({
        infoHash,
        bytesDownloaded: bytesUploaded, // from seeder's perspective, upload = peer's download
        durationSeconds,
      });

      const tags: string[][] = [
        ["d", infoHash],
        ["p", developerPubkey],
      ];

      const signedEvent = createEvent(
        {
          pubkey: pubkeyHex,
          created_at: nowSeconds,
          kind: EVENT_KIND_ATTESTATION,
          tags,
          content,
        },
        privkeyBytes,
      );

      // Verify our own event before storing (sanity check)
      if (!verifyEvent(signedEvent)) {
        console.error(
          `  ERROR ${torrent.name}: created event failed verification!`,
        );
        errors++;
        continue;
      }

      // Store directly via event store (bypasses REST auth)
      const result = await storeEvent(signedEvent);
      console.log(
        `  ${result} ${torrent.name} (${infoHash.slice(0, 8)}...): uploaded=${formatBytes(bytesUploaded)}, seeding=${formatDuration(durationSeconds)}`,
      );
      published++;
    } catch (err) {
      console.error(
        `  ERROR ${torrent.name} (${infoHash.slice(0, 8)}...):`,
        err instanceof Error ? err.message : err,
      );
      errors++;
    }
  }

  console.log(
    `\nDone: ${published} published, ${skipped} skipped, ${errors} errors`,
  );
  await db.$disconnect();
}

// ─── Formatting Helpers ─────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

// ─── Run ────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
