import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

/**
 * Simple JSON-file persistence store in the user data directory.
 * Stores: refresh token, install directory, installed games registry, settings.
 */

export interface PrivacySettings {
  mode: "off" | "tor" | "socks5";
  socksHost: string;
  socksPort: number;
  socksUsername?: string;
  socksPassword?: string;
  routeApiTraffic: boolean;
  routeTorrentTraffic: boolean;
}

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  mode: "off",
  socksHost: "",
  socksPort: 1080,
  routeApiTraffic: false,
  routeTorrentTraffic: false,
};

export interface RelayEntry {
  url: string;
  name: string;
  isDefault: boolean;
  enabled: boolean;
}

export const DEFAULT_RELAYS: RelayEntry[] = [
  { url: "wss://boilerdeck.com/relay", name: "BoilerDeck", isDefault: true, enabled: true },
];

interface StoreData {
  refreshToken?: string;
  installDir?: string;
  installedGames?: Record<string, InstalledGameEntry>;
  settings?: {
    downloadSpeedLimit?: number;
    uploadSpeedLimit?: number;
  };
  selfCustodyKey?: string;
  relayPrivkey?: string;
  relayPubkey?: string;
  privacySettings?: PrivacySettings;
  relays?: RelayEntry[];
  sovereignMode?: boolean;
  cachedListings?: { listings: unknown[]; cachedAt: string };
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
  "relayPrivkey",
  "relayPubkey",
  "privacySettings",
  "relays",
  "sovereignMode",
  "cachedListings",
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
