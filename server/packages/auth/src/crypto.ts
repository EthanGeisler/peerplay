/**
 * Cryptographic utilities for Nostr-compatible keypair identity.
 *
 * Curve: secp256k1 (Schnorr signatures, NIP-01)
 * Key derivation: BIP39 mnemonic → BIP32 HD key → NIP-06 path m/44'/1237'/0'/0/0
 * Encryption: AES-256-GCM with scrypt-derived key (format v1)
 */

import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { HDKey } from "@scure/bip32";
import {
  generateMnemonic as bip39GenerateMnemonic,
  mnemonicToSeedSync,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { bech32 } from "@scure/base";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

// NIP-06 derivation path for Nostr keys
const NIP06_DERIVATION_PATH = "m/44'/1237'/0'/0/0";

// scrypt parameters for v1 encryption format — DO NOT change these,
// create a v2 format instead. Changing breaks all existing encrypted data.
const SCRYPT_N = 32768; // 2^15
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LEN = 32; // AES-256

// ─── Mnemonic & Keypair Generation ───────────────────────────────────

export function generateMnemonic(): string {
  return bip39GenerateMnemonic(wordlist);
}

export function mnemonicToKeypair(mnemonic: string): {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
} {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdkey = HDKey.fromMasterSeed(seed).derive(NIP06_DERIVATION_PATH);

  if (!hdkey.privateKey || !hdkey.publicKey) {
    throw new Error("Key derivation failed — no key at NIP-06 path");
  }

  // HDKey gives 33-byte compressed pubkey; Nostr/Schnorr needs 32-byte x-only (drop prefix byte)
  const publicKey = hdkey.publicKey.slice(1);
  const privateKey = hdkey.privateKey;

  return { publicKey, privateKey };
}

export function generateKeypair(): {
  mnemonic: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
} {
  const mnemonic = generateMnemonic();
  const { publicKey, privateKey } = mnemonicToKeypair(mnemonic);
  return { mnemonic, publicKey, privateKey };
}

// ─── Encryption (AES-256-GCM, scrypt key derivation) ────────────────
//
// Format: v1:salt(32B hex):nonce(12B hex):tag(16B hex):ciphertext(hex)

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, SCRYPT_KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2, // 2x the required memory (64 MB)
  }) as Buffer;
}

function encryptBytes(data: Uint8Array, password: string): string {
  const salt = randomBytes(32);
  const nonce = randomBytes(12);
  const key = deriveKey(password, salt);

  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    salt.toString("hex"),
    nonce.toString("hex"),
    tag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

function decryptBytes(encoded: string, password: string): Buffer {
  const parts = encoded.split(":");
  if (parts[0] !== "v1" || parts.length !== 5) {
    throw new Error("Unsupported encryption format");
  }

  const salt = Buffer.from(parts[1], "hex");
  const nonce = Buffer.from(parts[2], "hex");
  const tag = Buffer.from(parts[3], "hex");
  const ciphertext = Buffer.from(parts[4], "hex");

  const key = deriveKey(password, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptPrivateKey(
  privateKey: Uint8Array,
  password: string,
): string {
  return encryptBytes(privateKey, password);
}

export function decryptPrivateKey(
  encrypted: string,
  password: string,
): Uint8Array {
  return new Uint8Array(decryptBytes(encrypted, password));
}

export function encryptMnemonic(mnemonic: string, password: string): string {
  return encryptBytes(Buffer.from(mnemonic, "utf-8"), password);
}

export function decryptMnemonic(encrypted: string, password: string): string {
  return decryptBytes(encrypted, password).toString("utf-8");
}

// ─── Schnorr Signing & Verification ─────────────────────────────────

export function schnorrSign(
  privateKey: Uint8Array,
  messageHash: Uint8Array,
): Uint8Array {
  return schnorr.sign(messageHash, privateKey);
}

export function schnorrVerify(
  publicKey: Uint8Array,
  messageHash: Uint8Array,
  signature: Uint8Array,
): boolean {
  return schnorr.verify(signature, messageHash, publicKey);
}

// ─── Encoding Helpers ───────────────────────────────────────────────

export function pubkeyHex(publicKey: Uint8Array): string {
  return Buffer.from(publicKey).toString("hex").toLowerCase();
}

export function pubkeyToNpub(publicKey: Uint8Array): string {
  return bech32.encode("npub", bech32.toWords(publicKey));
}

export function privkeyToNsec(privateKey: Uint8Array): string {
  return bech32.encode("nsec", bech32.toWords(privateKey));
}
