import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;
let torrentWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTorrentWindow(): void {
  torrentWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  torrentWindow.on('closed', () => {
    torrentWindow = null;
  });
}

function setupIpcHandlers(): void {
  ipcMain.handle('app:get-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('games:launch', (_event, exePath: string) => {
    console.log(`[stub] Launching game: ${exePath}`);
    // TODO: spawn child process with exePath
    return { success: true };
  });

  ipcMain.handle('downloads:start', (_event, magnetUri: string) => {
    console.log(`[stub] Starting download: ${magnetUri}`);
    return { success: true };
  });

  ipcMain.handle('downloads:pause', (_event, infoHash: string) => {
    console.log(`[stub] Pausing download: ${infoHash}`);
    return { success: true };
  });

  ipcMain.handle('downloads:get-progress', () => {
    return [];
  });
}

app.whenReady().then(() => {
  setupIpcHandlers();
  createMainWindow();
  createTorrentWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
