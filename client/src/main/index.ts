import { app, BrowserWindow, ipcMain, shell, dialog } from "electron";
import * as path from "path";
import { autoUpdater } from "electron-updater";
import { initStore, storeGet, storeSet, storeDelete, getDefaultInstallDir, isAllowedStoreKey } from "./store.js";
import * as torrentManager from "./torrentManager.js";
import * as gameLauncher from "./gameLauncher.js";


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
      console.warn(`[store] Blocked read of disallowed key: "${key}"`);
      return undefined;
    }
    return storeGet(key);
  });

  ipcMain.handle("store:set", (_event, key: string, value: unknown) => {
    if (!isAllowedStoreKey(key)) {
      console.warn(`[store] Blocked write of disallowed key: "${key}"`);
      return false;
    }
    storeSet(key, value);
    return true;
  });

  ipcMain.handle("store:delete", (_event, key: string) => {
    if (!isAllowedStoreKey(key)) {
      console.warn(`[store] Blocked delete of disallowed key: "${key}"`);
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
  if (mainWindow) torrentManager.setMainWindow(mainWindow);
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
