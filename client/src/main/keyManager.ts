/**
 * Key manager for self-custody Nostr identity.
 *
 * Handles keypair generation, import, signing, and encrypted storage.
 * Private keys are encrypted at rest using Electron's safeStorage
 * (Windows DPAPI / macOS Keychain / Linux Secret Service).
 *
 * Mnemonic is NOT stored — it's shown once at generation time and must
 * be backed up by the user. exportMnemonic() always returns null.
 *
 * NIP-06 derivation path: m/44'/1237'/0'/0/0
 * Public key format: x-only (32 bytes, no 02/03 prefix)
 *
 * All ESM-only packages (@noble/curves, @noble/hashes, @scure/bip39,
 * @scure/bip32) are loaded via dynamic import() because the main
 * process compiles to CJS.
 */

import { safeStorage } from "electron";
import { storeGet, storeSet } from "./store.js";

const NIP06_PATH = "m/44'/1237'/0'/0/0";

// ─── Internal helpers ─────────────────────────────────────────────

/**
 * Decrypt the stored private key and return it as a hex string.
 * Throws if no key is stored.
 */
export function getPrivateKeyHex(): string {
  const encryptedB64 = storeGet("selfCustodyKey") as string | null;
  if (!encryptedB64) {
    throw new Error("No self-custody key found. Generate or import a keypair first.");
  }
  return safeStorage.decryptString(Buffer.from(encryptedB64, "base64"));
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Generate a new mnemonic, derive a keypair, and store the encrypted
 * private key. Returns the mnemonic (show once!) and public key hex.
 */
export async function generateKeypair(): Promise<{ mnemonic: string; pubkeyHex: string }> {
  const { generateMnemonic, mnemonicToSeedSync } = await import("@scure/bip39");
  const { wordlist } = await import("@scure/bip39/wordlists/english.js");
  const { HDKey } = await import("@scure/bip32");
  const { bytesToHex } = await import("@noble/hashes/utils.js");

  const mnemonic = generateMnemonic(wordlist);
  const seed = mnemonicToSeedSync(mnemonic);
  const hdkey = HDKey.fromMasterSeed(seed).derive(NIP06_PATH);
  const privateKey = hdkey.privateKey!;
  const publicKey = hdkey.publicKey!.slice(1); // drop 02/03 prefix -> 32-byte x-only

  // Encrypt private key with safeStorage (OS-level encryption)
  const privkeyHex = bytesToHex(privateKey);
  const encrypted = safeStorage.encryptString(privkeyHex);
  storeSet("selfCustodyKey", encrypted.toString("base64"));

  return {
    mnemonic,
    pubkeyHex: bytesToHex(publicKey),
  };
}

/**
 * Import a mnemonic phrase, derive a keypair, and store the encrypted
 * private key. Throws if the mnemonic is invalid.
 */
export async function importMnemonic(mnemonic: string): Promise<{ pubkeyHex: string }> {
  const { mnemonicToSeedSync, validateMnemonic } = await import("@scure/bip39");
  const { wordlist } = await import("@scure/bip39/wordlists/english.js");
  const { HDKey } = await import("@scure/bip32");
  const { bytesToHex } = await import("@noble/hashes/utils.js");

  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error("Invalid recovery phrase. Please check your words and try again.");
  }

  const seed = mnemonicToSeedSync(mnemonic);
  const hdkey = HDKey.fromMasterSeed(seed).derive(NIP06_PATH);
  const privateKey = hdkey.privateKey!;
  const publicKey = hdkey.publicKey!.slice(1); // drop 02/03 prefix -> 32-byte x-only

  const privkeyHex = bytesToHex(privateKey);
  const encrypted = safeStorage.encryptString(privkeyHex);
  storeSet("selfCustodyKey", encrypted.toString("base64"));

  return {
    pubkeyHex: bytesToHex(publicKey),
  };
}

/**
 * Return the public key hex derived from the stored encrypted private key,
 * or null if no key is stored.
 */
export async function getPublicKey(): Promise<string | null> {
  const encryptedB64 = storeGet("selfCustodyKey") as string | null;
  if (!encryptedB64) return null;

  const { schnorr } = await import("@noble/curves/secp256k1.js");
  const { hexToBytes, bytesToHex } = await import("@noble/hashes/utils.js");

  const privkeyHex = safeStorage.decryptString(Buffer.from(encryptedB64, "base64"));
  return bytesToHex(schnorr.getPublicKey(hexToBytes(privkeyHex)));
}

/**
 * Sign a hex-encoded challenge with Schnorr (SHA-256 of the challenge bytes).
 * Returns the signature and public key hex.
 */
export async function signChallenge(challengeHex: string): Promise<{ signature: string; pubkeyHex: string }> {
  const { schnorr } = await import("@noble/curves/secp256k1.js");
  const { sha256 } = await import("@noble/hashes/sha2.js");
  const { hexToBytes, bytesToHex } = await import("@noble/hashes/utils.js");

  const privkeyHex = getPrivateKeyHex();
  const privateKey = hexToBytes(privkeyHex);

  const challengeBytes = hexToBytes(challengeHex);
  const messageHash = sha256(challengeBytes);
  const signature = schnorr.sign(messageHash, privateKey);

  return {
    signature: bytesToHex(signature),
    pubkeyHex: bytesToHex(schnorr.getPublicKey(privateKey)),
  };
}

/**
 * Build, sign, and return a Nostr event (NIP-01 compliant).
 * Does NOT publish — caller is responsible for that.
 */
export async function signEvent(
  content: string,
  kind: number,
  tags: string[][],
): Promise<{
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}> {
  const { schnorr } = await import("@noble/curves/secp256k1.js");
  const { sha256 } = await import("@noble/hashes/sha2.js");
  const { hexToBytes, bytesToHex } = await import("@noble/hashes/utils.js");

  const privkeyHex = getPrivateKeyHex();
  const privateKey = hexToBytes(privkeyHex);
  const pubkeyHex = bytesToHex(schnorr.getPublicKey(privateKey));

  const created_at = Math.floor(Date.now() / 1000);

  // NIP-01: SHA-256 of [0, pubkey, created_at, kind, tags, content]
  const serialized = JSON.stringify([0, pubkeyHex, created_at, kind, tags, content]);
  const idBytes = sha256(new TextEncoder().encode(serialized));
  const id = bytesToHex(idBytes);

  const sig = bytesToHex(schnorr.sign(idBytes, privateKey));

  return { id, pubkey: pubkeyHex, created_at, kind, tags, content, sig };
}

/**
 * Check whether a self-custody key exists in the store.
 */
export function hasKey(): boolean {
  return storeGet("selfCustodyKey") != null;
}

/**
 * Mnemonic is not stored (shown once at generation time).
 * Returns null. Users who need recovery must use their backed-up mnemonic,
 * or fetch their server-side encrypted mnemonic via the API (custodial users).
 */
export function exportMnemonic(): null {
  return null;
}
