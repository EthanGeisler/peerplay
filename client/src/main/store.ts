import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

/**
 * Simple JSON-file persistence store in the user data directory.
 * Stores: refresh token, install directory, installed games registry, settings.
 */

interface StoreData {
  refreshToken?: string;
  installDir?: string;
  installedGames?: Record<string, InstalledGameEntry>;
  settings?: {
    downloadSpeedLimit?: number;
    uploadSpeedLimit?: number;
  };
  selfCustodyKey?: string;
}

interface InstalledGameEntry {
  gameId: string;
  title: string;
  slug: string;
  installPath: string;
  exePath: string | null;
  version: string;
  coverImageUrl: string | null;
  installedAt: string;
}

const STORE_FILENAME = "boilerdeck-config.json";

/** Only these keys may be read/written via IPC. */
export const STORE_KEY_WHITELIST = new Set([
  "refreshToken",
  "installDir",
  "installedGames",
  "settings",
  "selfCustodyKey",
]);

export function isAllowedStoreKey(key: string): boolean {
  return STORE_KEY_WHITELIST.has(key);
}

let data: StoreData = {};
let storePath: string;

export function initStore(): void {
  storePath = path.join(app.getPath("userData"), STORE_FILENAME);
  try {
    const raw = fs.readFileSync(storePath, "utf-8");
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
}

function save(): void {
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2), "utf-8");
}

export function storeGet(key: string): unknown {
  return (data as Record<string, unknown>)[key] ?? null;
}

export function storeSet(key: string, value: unknown): void {
  (data as Record<string, unknown>)[key] = value;
  save();
}

export function storeDelete(key: string): void {
  delete (data as Record<string, unknown>)[key];
  save();
}

export function getDefaultInstallDir(): string {
  const stored = storeGet("installDir") as string | null;
  if (stored) return stored;
  return path.join(app.getPath("userData"), "games");
}
