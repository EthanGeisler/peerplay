/**
 * Auto-attestation module for completed torrent downloads.
 *
 * When a torrent download completes, this module creates and publishes
 * a kind 31338 attestation event to the relay. The attestation includes
 * the infoHash, bytes downloaded, and duration. The `p` tag references
 * the game developer's pubkey (content creator).
 *
 * Attestation failure never blocks the download flow — all errors are
 * caught and logged.
 */

import { storeGet } from "./store.js";
import * as relayManager from "./relayManager.js";
import { safeStorage } from "electron";

// ─── Types ──────────────────────────────────────────────────────────

export interface AttestationParams {
  infoHash: string;
  bytesDownloaded: number;
  durationSeconds: number;
  developerPubkey: string;
}

// ─── Constants ──────────────────────────────────────────────────────

const KIND_ATTESTATION = 31338;

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Create, sign, and publish an attestation event for a completed download.
 *
 * This is called directly from torrentManager (main process), not via IPC.
 * It follows the same signing pattern as `events:sign-and-publish-review`
 * in index.ts but as a direct function call.
 *
 * @returns The signed event if successful, or null if attestation could not
 *          be generated (missing keys, relay not connected, etc.)
 */
export async function publishAttestation(
  params: AttestationParams,
): Promise<Record<string, unknown> | null> {
  const { infoHash, bytesDownloaded, durationSeconds, developerPubkey } = params;

  // Lazy-import crypto libraries (same pattern as IPC handlers in index.ts)
  const { schnorr } = await import("@noble/curves/secp256k1.js");
  const { sha256 } = await import("@noble/hashes/sha2.js");
  const { hexToBytes, bytesToHex } = await import("@noble/hashes/utils.js");

  // 1. Get the user's private key — try cached relay key, then self-custody key
  let privkeyHex: string | null = storeGet("relayPrivkey") as string | null;
  let pubkeyHex: string | null = storeGet("relayPubkey") as string | null;

  if (!privkeyHex) {
    const encryptedB64 = storeGet("selfCustodyKey") as string | null;
    if (encryptedB64) {
      privkeyHex = safeStorage.decryptString(Buffer.from(encryptedB64, "base64"));
      pubkeyHex = bytesToHex(schnorr.getPublicKey(hexToBytes(privkeyHex)));
    }
  }

  if (!privkeyHex || !pubkeyHex) {
    console.log("[attestation] No signing key available — skipping attestation");
    return null;
  }

  // 2. Self-attestation guard: user's pubkey must differ from developer pubkey
  if (pubkeyHex.toLowerCase() === developerPubkey.toLowerCase()) {
    console.log("[attestation] Skipping self-attestation (user is the developer)");
    return null;
  }

  const privateKey = hexToBytes(privkeyHex);

  // 3. Build the kind 31338 attestation event
  const content = JSON.stringify({
    infoHash,
    bytesDownloaded,
    durationSeconds,
  });
  const tags: string[][] = [
    ["d", infoHash],
    ["p", developerPubkey],
  ];
  const created_at = Math.floor(Date.now() / 1000);

  // 4. Compute event ID (NIP-01: SHA-256 of [0, pubkey, created_at, kind, tags, content])
  const serialized = JSON.stringify([0, pubkeyHex, created_at, KIND_ATTESTATION, tags, content]);
  const idBytes = sha256(new TextEncoder().encode(serialized));
  const id = bytesToHex(idBytes);

  // 5. Sign with Schnorr
  const sig = bytesToHex(schnorr.sign(idBytes, privateKey));

  const signedEvent = { id, pubkey: pubkeyHex, created_at, kind: KIND_ATTESTATION, tags, content, sig };

  // 6. Publish via relay WebSocket
  const result = relayManager.publish(signedEvent as any);
  if (!result.success) {
    console.warn("[attestation] Failed to publish to relay:", result.error);
    // Not a fatal error — attestation is best-effort
    return null;
  }

  console.log(`[attestation] Published attestation for infoHash=${infoHash}, bytes=${bytesDownloaded}, duration=${durationSeconds}s`);
  return signedEvent;
}
