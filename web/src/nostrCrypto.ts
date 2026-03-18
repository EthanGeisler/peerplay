/**
 * Browser-side Nostr crypto utilities.
 * Mirrors server/packages/auth/src/crypto.ts derivation logic.
 *
 * Uses the same @noble/@scure packages that the server uses — Vite bundles them for the browser.
 */

import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { HDKey } from "@scure/bip32";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

const NIP06_DERIVATION_PATH = "m/44'/1237'/0'/0/0";

export function generateKeypairInBrowser(): {
  mnemonic: string;
  pubkeyHex: string;
  privateKey: Uint8Array;
} {
  const mnemonic = generateMnemonic(wordlist);
  const { pubkeyHex, privateKey } = deriveFromMnemonic(mnemonic);
  return { mnemonic, pubkeyHex, privateKey };
}

export function deriveFromMnemonic(mnemonic: string): {
  pubkeyHex: string;
  privateKey: Uint8Array;
} {
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error("Invalid recovery phrase. Please check your words and try again.");
  }

  const seed = mnemonicToSeedSync(mnemonic);
  const hdkey = HDKey.fromMasterSeed(seed).derive(NIP06_DERIVATION_PATH);

  if (!hdkey.privateKey || !hdkey.publicKey) {
    throw new Error("Key derivation failed — no key at NIP-06 path");
  }

  // HDKey gives 33-byte compressed pubkey; Nostr/Schnorr needs 32-byte x-only (drop prefix byte)
  const publicKey = hdkey.publicKey.slice(1);
  const privateKey = hdkey.privateKey;

  return {
    pubkeyHex: bytesToHex(publicKey),
    privateKey,
  };
}

export function signChallenge(challengeHex: string, privateKey: Uint8Array): string {
  const challengeBytes = hexToBytes(challengeHex);
  const messageHash = sha256(challengeBytes);
  const signature = schnorr.sign(messageHash, privateKey);
  return bytesToHex(signature);
}
