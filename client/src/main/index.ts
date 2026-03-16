import { app, BrowserWindow, ipcMain, shell, dialog } from "electron";
import * as path from "path";
import { initStore, storeGet, storeSet, storeDelete, getDefaultInstallDir } from "./store.js";
import * as torrentManager from "./torrentManager.js";
import * as gameLauncher from "./gameLauncher.js";
import { getDeviceFingerprint } from "./fingerprint.js";
import { decryptGameFiles } from "./decryptor.js";

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;

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
    return storeGet(key);
  });

  ipcMain.handle("store:set", (_event, key: string, value: unknown) => {
    storeSet(key, value);
    return true;
  });

  ipcMain.handle("store:delete", (_event, key: string) => {
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

  // --- DRM ---
  ipcMain.handle("drm:get-fingerprint", () => {
    return getDeviceFingerprint();
  });

  ipcMain.handle("drm:decrypt-game", async (_event, opts: { installPath: string; key: string; algorithm: string }) => {
    return decryptGameFiles(opts);
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
}

app.whenReady().then(() => {
  initStore();
  setupIpcHandlers();
  createMainWindow();
  if (mainWindow) torrentManager.setMainWindow(mainWindow);

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
