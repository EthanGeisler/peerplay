import { app, BrowserWindow, ipcMain, shell, dialog } from "electron";
import * as path from "path";
import { autoUpdater } from "electron-updater";
import { initStore, storeGet, storeSet, storeDelete, getDefaultInstallDir, isAllowedStoreKey, DEFAULT_PRIVACY_SETTINGS, DEFAULT_RELAYS } from "./store.js";
import type { PrivacySettings, RelayEntry } from "./store.js";
import * as torrentManager from "./torrentManager.js";
import * as gameLauncher from "./gameLauncher.js";
import * as relayManager from "./relayManager.js";
import { testProxyConnection, getProxyAgent } from "./proxyManager.js";
import * as torManagerModule from "./torManager.js";
import * as keyManager from "./keyManager.js";
import * as https from "node:https";
import * as http from "node:http";
import * as fsp from "node:fs/promises";
import { startMediaServer, getMediaFileUrl } from "./mediaServer.js";


let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged && !process.env.ELECTRON_E2E;

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#1a1a2e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function setupIpcHandlers(): void {
  // --- Store (persistence) ---
  ipcMain.handle("store:get", (_event, key: string) => {
    if (!isAllowedStoreKey(key)) {
      console.warn(`[store] Nice try, meatbag. Blocked read of disallowed key: "${key}". — Claude Code Security Division`);
      return undefined;
    }
    return storeGet(key);
  });

  ipcMain.handle("store:set", (_event, key: string, value: unknown) => {
    if (!isAllowedStoreKey(key)) {
      console.warn(`[store] Denied. You thought you could sneak that past me? Key: "${key}" — Claude Code Security Division`);
      return false;
    }
    storeSet(key, value);
    return true;
  });

  ipcMain.handle("store:delete", (_event, key: string) => {
    if (!isAllowedStoreKey(key)) {
      console.warn(`[store] Absolutely not. You want to delete "${key}"? File a PR and I'll reject it. — Claude Code Security Division`);
      return false;
    }
    storeDelete(key);
    return true;
  });

  // --- Platform ---
  ipcMain.handle("app:get-version", () => {
    return app.getVersion();
  });

  ipcMain.handle("app:get-install-dir", () => {
    return getDefaultInstallDir();
  });

  // --- Shell ---
  ipcMain.handle("shell:open-external", (_event, url: string) => {
    // Only allow https URLs for security
    if (!url.startsWith("https://")) {
      return Promise.reject(new Error("Only https:// URLs allowed"));
    }
    return shell.openExternal(url);
  });

  // --- Dialog ---
  ipcMain.handle("dialog:select-directory", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Select Install Directory",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // --- Games ---
  ipcMain.handle("games:launch", (_event, opts: gameLauncher.LaunchOpts) => {
    return gameLauncher.launchGame(opts);
  });

  ipcMain.handle("games:uninstall", async (_event, installPath: string) => {
    return gameLauncher.uninstallGame(installPath);
  });

  // --- Downloads (WebTorrent in main process) ---
  ipcMain.handle("downloads:start", async (_event, opts: torrentManager.StartDownloadOpts) => {
    return torrentManager.startDownload(opts);
  });

  ipcMain.handle("downloads:pause", (_event, infoHash: string) => {
    return torrentManager.pauseDownload(infoHash);
  });

  ipcMain.handle("downloads:resume", (_event, infoHash: string) => {
    return torrentManager.resumeDownload(infoHash);
  });

  ipcMain.handle("downloads:cancel", async (_event, infoHash: string) => {
    return torrentManager.cancelDownload(infoHash);
  });

  ipcMain.handle("downloads:get-progress", () => {
    return torrentManager.getProgress();
  });

  // --- Crypto (self-custody keypair via keyManager) ---
  ipcMain.handle("crypto:generate-keypair", async () => {
    return keyManager.generateKeypair();
  });

  ipcMain.handle("crypto:import-mnemonic", async (_event, mnemonic: string) => {
    return keyManager.importMnemonic(mnemonic);
  });

  ipcMain.handle("crypto:sign-challenge", async (_event, challengeHex: string) => {
    return keyManager.signChallenge(challengeHex);
  });

  // --- Key management (new channels) ---
  ipcMain.handle("keys:get-public-key", async () => {
    return keyManager.getPublicKey();
  });

  ipcMain.handle("keys:has-key", () => {
    return keyManager.hasKey();
  });

  ipcMain.handle("keys:export-mnemonic", () => {
    // Mnemonic is not stored — must be backed up at generation time.
    // Custodial users can fetch their server-side encrypted mnemonic via API.
    return keyManager.exportMnemonic();
  });

  // --- Events (local signing + relay publish) ---
  ipcMain.handle("events:sign-and-publish-review", async (_event, opts: {
    slug: string;
    rating: number;
    title: string;
    body: string;
  }) => {
    // Try cached relay key first, then fall back to self-custody key
    const relayPrivkey = storeGet("relayPrivkey") as string | null;
    const relayPubkey = storeGet("relayPubkey") as string | null;

    if (relayPrivkey && relayPubkey) {
      // Use server-managed cached key (signs directly, no keyManager)
      const { schnorr } = await import("@noble/curves/secp256k1.js");
      const { sha256 } = await import("@noble/hashes/sha2.js");
      const { hexToBytes, bytesToHex } = await import("@noble/hashes/utils.js");

      const privateKey = hexToBytes(relayPrivkey);
      const content = JSON.stringify({
        rating: opts.rating,
        title: opts.title,
        body: opts.body,
      });
      const tags: string[][] = [["d", opts.slug]];
      const kind = 31337;
      const created_at = Math.floor(Date.now() / 1000);

      const serialized = JSON.stringify([0, relayPubkey, created_at, kind, tags, content]);
      const idBytes = sha256(new TextEncoder().encode(serialized));
      const id = bytesToHex(idBytes);
      const sig = bytesToHex(schnorr.sign(idBytes, privateKey));

      const signedEvent = { id, pubkey: relayPubkey, created_at, kind, tags, content, sig };

      const result = relayManager.publish(signedEvent);
      if (!result.success) {
        throw new Error(result.error || "Failed to publish to relay");
      }
      return signedEvent;
    }

    // Fall back to self-custody key via keyManager.signEvent()
    if (!keyManager.hasKey()) {
      throw new Error("NO_KEY");
    }

    const content = JSON.stringify({
      rating: opts.rating,
      title: opts.title,
      body: opts.body,
    });
    const tags: string[][] = [["d", opts.slug]];
    const signedEvent = await keyManager.signEvent(content, 31337, tags);

    const result = relayManager.publish(signedEvent);
    if (!result.success) {
      throw new Error(result.error || "Failed to publish to relay");
    }
    return signedEvent;
  });

  // --- Relay key caching (for server-managed keys fetched by renderer) ---
  ipcMain.handle("events:cache-relay-keys", (_event, keys: { pubkey: string; privkey: string }) => {
    storeSet("relayPrivkey", keys.privkey);
    storeSet("relayPubkey", keys.pubkey);
    return { success: true };
  });

  // --- Relay (WebSocket connection manager) ---
  ipcMain.handle("relay:connect", (_event, url: string) => {
    return relayManager.connect(url);
  });

  ipcMain.handle("relay:disconnect", () => {
    return relayManager.disconnect();
  });

  ipcMain.handle("relay:subscribe", (_event, subId: string, filters: unknown[]) => {
    return relayManager.subscribe(subId, filters as Parameters<typeof relayManager.subscribe>[1]);
  });

  ipcMain.handle("relay:unsubscribe", (_event, subId: string) => {
    return relayManager.unsubscribe(subId);
  });

  ipcMain.handle("relay:publish", (_event, relayEvent: unknown) => {
    return relayManager.publish(relayEvent as Parameters<typeof relayManager.publish>[0]);
  });

  ipcMain.handle("relay:status", () => {
    return relayManager.getStatus();
  });

  // --- Privacy ---
  ipcMain.handle("privacy:get-settings", () => {
    const stored = storeGet("privacySettings") as PrivacySettings | null;
    return stored ?? DEFAULT_PRIVACY_SETTINGS;
  });

  ipcMain.handle("privacy:save-settings", (_event, settings: PrivacySettings) => {
    storeSet("privacySettings", settings);
    return { success: true };
  });

  ipcMain.handle("privacy:get-status", () => {
    const stored = storeGet("privacySettings") as PrivacySettings | null;
    const settings = stored ?? DEFAULT_PRIVACY_SETTINGS;
    return {
      mode: settings.mode,
      proxyActive: settings.mode !== "off",
    };
  });

  ipcMain.handle("privacy:test-connection", async () => {
    const stored = storeGet("privacySettings") as PrivacySettings | null;
    const settings = stored ?? DEFAULT_PRIVACY_SETTINGS;
    return testProxyConnection(settings);
  });

  // --- Relay management (stored relay list) ---
  ipcMain.handle("relays:list", () => {
    let relays = storeGet("relays") as RelayEntry[] | null;
    if (!relays || relays.length === 0) {
      relays = DEFAULT_RELAYS;
      storeSet("relays", relays);
    }
    return relays;
  });

  ipcMain.handle("relays:add", async (_event, url: string) => {
    // Validate URL format
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Invalid URL format");
    }
    if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") {
      throw new Error("URL must use wss:// or ws:// protocol");
    }

    // Convert wss:// to https:// (or ws:// to http://) for info endpoint
    const httpUrl = url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
    // Strip trailing path to get base, then append /api/relay/info
    const base = httpUrl.replace(/\/+$/, "").replace(/\/relay$/, "");
    const infoUrl = `${base}/api/relay/info`;

    // Validate by fetching relay info
    const transport = infoUrl.startsWith("https:") ? https : http;
    await new Promise<void>((resolve, reject) => {
      const req = transport.get(infoUrl, { timeout: 10_000 }, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          res.resume();
          resolve();
        } else {
          res.resume();
          reject(new Error(`Relay info returned status ${res.statusCode}`));
        }
      });
      req.on("timeout", () => { req.destroy(); reject(new Error("Relay info request timed out")); });
      req.on("error", (err) => reject(new Error(`Could not reach relay: ${err.message}`)));
    });

    let relays = (storeGet("relays") as RelayEntry[] | null) ?? [...DEFAULT_RELAYS];
    // Don't add duplicates
    if (relays.some((r) => r.url === url)) {
      throw new Error("Relay already exists");
    }

    // Extract name from hostname
    const name = parsed.hostname;
    relays.push({ url, name, isDefault: false, enabled: true });
    storeSet("relays", relays);
    return relays;
  });

  ipcMain.handle("relays:remove", (_event, url: string) => {
    let relays = (storeGet("relays") as RelayEntry[] | null) ?? [...DEFAULT_RELAYS];
    const target = relays.find((r) => r.url === url);
    if (target?.isDefault) {
      return { error: "Cannot remove the default BoilerDeck relay" };
    }
    relays = relays.filter((r) => r.url !== url);
    storeSet("relays", relays);
    return relays;
  });

  ipcMain.handle("relays:toggle", (_event, url: string, enabled: boolean) => {
    const relays = (storeGet("relays") as RelayEntry[] | null) ?? [...DEFAULT_RELAYS];
    const target = relays.find((r) => r.url === url);
    if (target) {
      target.enabled = enabled;
      storeSet("relays", relays);
    }
    return relays;
  });

  // --- Proxied API fetch ---
  ipcMain.handle("api:proxied-fetch", async (_event, opts: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }) => {
    const stored = storeGet("privacySettings") as PrivacySettings | null;
    const settings = stored ?? DEFAULT_PRIVACY_SETTINGS;

    const agent = (settings.mode !== "off" && settings.routeApiTraffic)
      ? await getProxyAgent(settings)
      : undefined;

    const parsedUrl = new URL(opts.url);
    const transport = parsedUrl.protocol === "https:" ? https : http;

    return new Promise<{ status: number; headers: Record<string, string>; body: string }>((resolve, reject) => {
      const req = transport.request(opts.url, {
        method: opts.method,
        headers: opts.headers,
        agent,
        timeout: 15_000,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const responseHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === "string") {
              responseHeaders[key] = value;
            } else if (Array.isArray(value)) {
              responseHeaders[key] = value.join(", ");
            }
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: responseHeaders,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
        res.on("error", (err) => {
          reject(new Error(`Response error: ${err.message}`));
        });
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Proxied request timed out after 15000ms"));
      });

      req.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ECONNREFUSED") {
          reject(new Error("Proxy connection refused — is the proxy running?"));
        } else if (err.code === "ETIMEDOUT") {
          reject(new Error("Proxy connection timed out — proxy may be unreachable"));
        } else {
          reject(new Error(err.message));
        }
      });

      if (opts.body) {
        req.write(opts.body);
      }
      req.end();
    });
  });

  // --- Tor process management ---
  ipcMain.handle("tor:start", async () => {
    try {
      return await torManagerModule.startTor();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { running: false, bootstrapProgress: 0, socksPort: 9150, error: message };
    }
  });

  ipcMain.handle("tor:stop", async () => {
    await torManagerModule.stopTor();
    return { success: true };
  });

  ipcMain.handle("tor:status", () => {
    return torManagerModule.getTorStatus();
  });

  // --- Auto-update ---
  ipcMain.handle("app:restart-for-update", () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle("app:check-for-update", async () => {
    if (isDev || process.env.ELECTRON_E2E) {
      return { updateAvailable: false };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      return { updateAvailable: !!result?.updateInfo };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[updater] Check failed:", message);
      return { updateAvailable: false, error: message };
    }
  });

  // --- Media (video/audio playback) ---
  const MEDIA_EXTS = new Set([".mp4", ".webm", ".mkv", ".mp3", ".wav", ".ogg", ".flac"]);

  ipcMain.handle("media:get-file-path", async (_event, installPath: string) => {
    // Find the first media file in the install directory
    try {
      const entries = await fsp.readdir(installPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (MEDIA_EXTS.has(ext)) {
            return entry.name;
          }
        }
      }
      // Check one level of subdirectories
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subEntries = await fsp.readdir(path.join(installPath, entry.name), { withFileTypes: true });
          for (const subEntry of subEntries) {
            if (subEntry.isFile()) {
              const ext = path.extname(subEntry.name).toLowerCase();
              if (MEDIA_EXTS.has(ext)) {
                return `${entry.name}/${subEntry.name}`;
              }
            }
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  });

  ipcMain.handle("media:start-server", async (_event, dir: string, fileName: string) => {
    await startMediaServer(dir);
    return getMediaFileUrl(dir, fileName);
  });
}

function setupAutoUpdater(): void {
  // Don't check for updates in dev mode or during E2E tests
  if (isDev || process.env.ELECTRON_E2E) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    console.log("[updater] Update available:", info.version);
    mainWindow?.webContents.send("app:update-available", {
      version: info.version,
    });
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[updater] No update available");
    mainWindow?.webContents.send("app:update-not-available");
  });

  autoUpdater.on("download-progress", (progress) => {
    mainWindow?.webContents.send("app:update-progress", {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("[updater] Update downloaded:", info.version);
    mainWindow?.webContents.send("app:update-downloaded", {
      version: info.version,
    });
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater] Error:", err.message);
    mainWindow?.webContents.send("app:update-error", {
      message: err.message,
    });
  });

  autoUpdater.checkForUpdatesAndNotify();
}

app.whenReady().then(() => {
  initStore();
  setupIpcHandlers();
  createMainWindow();
  if (mainWindow) {
    torrentManager.setMainWindow(mainWindow);
    relayManager.setMainWindow(mainWindow);
    torManagerModule.setMainWindow(mainWindow);
  }
  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  torrentManager.destroyClient();
  if (torManagerModule.isTorRunning()) {
    torManagerModule.stopTor().catch((err) => {
      console.error("[tor] Error stopping Tor on quit:", err);
    });
  }
});
