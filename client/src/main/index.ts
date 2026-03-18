import { app, BrowserWindow, ipcMain, shell, dialog, safeStorage } from "electron";
import * as path from "path";
import { autoUpdater } from "electron-updater";
import { initStore, storeGet, storeSet, storeDelete, getDefaultInstallDir, isAllowedStoreKey, DEFAULT_PRIVACY_SETTINGS } from "./store.js";
import type { PrivacySettings } from "./store.js";
import * as torrentManager from "./torrentManager.js";
import * as gameLauncher from "./gameLauncher.js";
import * as relayManager from "./relayManager.js";
import { testProxyConnection } from "./proxyManager.js";


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

  // --- Crypto (self-custody keypair generation) ---
  ipcMain.handle("crypto:generate-keypair", async () => {
    const { generateMnemonic, mnemonicToSeedSync } = await import("@scure/bip39");
    const { wordlist } = await import("@scure/bip39/wordlists/english.js");
    const { HDKey } = await import("@scure/bip32");
    const { bytesToHex } = await import("@noble/hashes/utils.js");

    const mnemonic = generateMnemonic(wordlist);
    const seed = mnemonicToSeedSync(mnemonic);
    const hdkey = HDKey.fromMasterSeed(seed).derive("m/44'/1237'/0'/0/0");
    const privateKey = hdkey.privateKey!;
    const publicKey = hdkey.publicKey!.slice(1); // drop 02/03 prefix → 32-byte x-only

    // Encrypt private key with safeStorage (OS-level encryption)
    const privkeyHex = bytesToHex(privateKey);
    const encrypted = safeStorage.encryptString(privkeyHex);
    storeSet("selfCustodyKey", encrypted.toString("base64"));

    return {
      mnemonic,
      pubkeyHex: bytesToHex(publicKey),
    };
  });

  ipcMain.handle("crypto:import-mnemonic", async (_event, mnemonic: string) => {
    const { mnemonicToSeedSync, validateMnemonic } = await import("@scure/bip39");
    const { wordlist } = await import("@scure/bip39/wordlists/english.js");
    const { HDKey } = await import("@scure/bip32");
    const { bytesToHex } = await import("@noble/hashes/utils.js");

    if (!validateMnemonic(mnemonic, wordlist)) {
      throw new Error("Invalid recovery phrase. Please check your words and try again.");
    }

    const seed = mnemonicToSeedSync(mnemonic);
    const hdkey = HDKey.fromMasterSeed(seed).derive("m/44'/1237'/0'/0/0");
    const privateKey = hdkey.privateKey!;
    const publicKey = hdkey.publicKey!.slice(1); // drop 02/03 prefix → 32-byte x-only

    // Encrypt private key with safeStorage (OS-level encryption)
    const privkeyHex = bytesToHex(privateKey);
    const encrypted = safeStorage.encryptString(privkeyHex);
    storeSet("selfCustodyKey", encrypted.toString("base64"));

    return {
      pubkeyHex: bytesToHex(publicKey),
    };
  });

  ipcMain.handle("crypto:sign-challenge", async (_event, challengeHex: string) => {
    const { schnorr } = await import("@noble/curves/secp256k1.js");
    const { sha256 } = await import("@noble/hashes/sha2.js");
    const { hexToBytes, bytesToHex } = await import("@noble/hashes/utils.js");

    // Retrieve and decrypt private key from store
    const encryptedB64 = storeGet("selfCustodyKey") as string | null;
    if (!encryptedB64) {
      throw new Error("No self-custody key found. Register with client-side key generation first.");
    }
    const privkeyHex = safeStorage.decryptString(Buffer.from(encryptedB64, "base64"));
    const privateKey = hexToBytes(privkeyHex);

    // Sign SHA-256(challenge bytes) with Schnorr
    const challengeBytes = hexToBytes(challengeHex);
    const messageHash = sha256(challengeBytes);
    const signature = schnorr.sign(messageHash, privateKey);

    return {
      signature: bytesToHex(signature),
      pubkeyHex: bytesToHex(schnorr.getPublicKey(privateKey)),
    };
  });

  // --- Events (local signing + relay publish) ---
  ipcMain.handle("events:sign-and-publish-review", async (_event, opts: {
    slug: string;
    rating: number;
    title: string;
    body: string;
  }) => {
    const { schnorr } = await import("@noble/curves/secp256k1.js");
    const { sha256 } = await import("@noble/hashes/sha2.js");
    const { hexToBytes, bytesToHex } = await import("@noble/hashes/utils.js");

    // 1. Get the user's private key — try cached key from store first, then fetch from server
    let privkeyHex: string | null = storeGet("relayPrivkey") as string | null;
    let pubkeyHex: string | null = storeGet("relayPubkey") as string | null;

    if (!privkeyHex) {
      // Need to fetch from server via apiFetch — renderer must pass tokens through IPC
      // Instead, we'll try the self-custody key first
      const encryptedB64 = storeGet("selfCustodyKey") as string | null;
      if (encryptedB64) {
        privkeyHex = safeStorage.decryptString(Buffer.from(encryptedB64, "base64"));
        pubkeyHex = bytesToHex(schnorr.getPublicKey(hexToBytes(privkeyHex)));
      }
    }

    if (!privkeyHex || !pubkeyHex) {
      throw new Error("NO_KEY");
    }

    const privateKey = hexToBytes(privkeyHex);

    // 2. Build the kind 31337 event
    const content = JSON.stringify({
      rating: opts.rating,
      title: opts.title,
      body: opts.body,
    });
    const tags: string[][] = [["d", opts.slug]];
    const kind = 31337;
    const created_at = Math.floor(Date.now() / 1000);

    // 3. Compute event ID (NIP-01: SHA-256 of [0, pubkey, created_at, kind, tags, content])
    const serialized = JSON.stringify([0, pubkeyHex, created_at, kind, tags, content]);
    const idBytes = sha256(new TextEncoder().encode(serialized));
    const id = bytesToHex(idBytes);

    // 4. Sign with Schnorr
    const sig = bytesToHex(schnorr.sign(idBytes, privateKey));

    const signedEvent = { id, pubkey: pubkeyHex, created_at, kind, tags, content, sig };

    // 5. Publish via relay WebSocket
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
});
