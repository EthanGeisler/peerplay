/**
 * Locker Settings — JSON file-based settings for the data locker.
 *
 * Stores auto-download, download path, and seed-after-download preferences
 * in `userData/locker-settings.json`.
 */

import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ─── Types ──────────────────────────────────────────────────────────

export interface LockerSettings {
  autoDownload: boolean;
  downloadPath: string;
  seedAfterDownload: boolean;
  includePeerHints: boolean;
  additionalRelays: string[];
}

// ─── State ──────────────────────────────────────────────────────────

let settingsPath: string | null = null;
let settings: LockerSettings | null = null;

function getSettingsPath(): string {
  if (!settingsPath) {
    settingsPath = path.join(app.getPath("userData"), "locker-settings.json");
  }
  return settingsPath;
}

function getDefaultDownloadPath(): string {
  return path.join(os.homedir(), "BoilerDeck", "Locker");
}

function getDefaults(): LockerSettings {
  return {
    autoDownload: false,
    downloadPath: getDefaultDownloadPath(),
    seedAfterDownload: false,
    includePeerHints: false,
    additionalRelays: [],
  };
}

function saveToFile(): void {
  if (!settings) return;
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), "utf-8");
  } catch (err) {
    console.error("[locker-settings] Failed to save settings:", err);
  }
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Load settings from disk. Returns the current settings.
 */
export function loadSettings(): LockerSettings {
  if (settings) return { ...settings };
  try {
    const raw = fs.readFileSync(getSettingsPath(), "utf-8");
    settings = { ...getDefaults(), ...JSON.parse(raw) } as LockerSettings;
  } catch {
    settings = getDefaults();
  }
  return { ...settings };
}

/**
 * Get current settings (loads from disk if needed).
 */
export function getSettings(): LockerSettings {
  return loadSettings();
}

/**
 * Set auto-download preference.
 */
export function setAutoDownload(enabled: boolean): void {
  if (!settings) loadSettings();
  settings!.autoDownload = enabled;
  saveToFile();
}

/**
 * Set the download path.
 */
export function setDownloadPath(newPath: string): void {
  if (!settings) loadSettings();
  settings!.downloadPath = newPath;
  saveToFile();
}

/**
 * Set seed-after-download preference.
 */
export function setSeedAfterDownload(enabled: boolean): void {
  if (!settings) loadSettings();
  settings!.seedAfterDownload = enabled;
  saveToFile();
}

/**
 * Set peer hints preference (opt-in to include IP in locker events).
 */
export function setIncludePeerHints(enabled: boolean): void {
  if (!settings) loadSettings();
  settings!.includePeerHints = enabled;
  saveToFile();
}

/**
 * Set additional relays for multi-relay publishing.
 */
export function setAdditionalRelays(relays: string[]): void {
  if (!settings) loadSettings();
  settings!.additionalRelays = relays;
  saveToFile();
}

/**
 * Get additional relays.
 */
export function getAdditionalRelays(): string[] {
  if (!settings) loadSettings();
  return [...(settings!.additionalRelays || [])];
}
