/**
 * torManager.ts — Manages the bundled Tor Expert Bundle process.
 *
 * Spawns the bundled tor binary from extraResources, monitors bootstrap progress,
 * and exposes start/stop/status APIs for the IPC layer.
 */

import { app, BrowserWindow } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as net from "node:net";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let torProcess: ChildProcess | null = null;
let bootstrapProgress = 0;
let mainWindow: BrowserWindow | null = null;

const SOCKS_PORT = 9150;
const BOOTSTRAP_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reference to the renderer window so we can push bootstrap events. */
export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

/** Resolve the path to the tor binary — production (extraResources) or dev fallback. */
function getTorBinaryPath(): string {
  const torBin = process.platform === "win32" ? "tor.exe" : "tor";

  if (app.isPackaged) {
    // In production the Tor Expert Bundle lives in resources/tor/
    return path.join(process.resourcesPath, "tor", torBin);
  }

  // Dev fallback: look next to the client directory
  const devPath = path.join(app.getAppPath(), "resources", "tor", torBin);
  return devPath;
}

/** Persistent data directory for Tor state (consensus, keys, etc.) */
function getTorDataDir(): string {
  const dir = path.join(app.getPath("userData"), "tor-data");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Quick check whether something is already listening on a port. */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(1000);
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("timeout", () => {
      sock.destroy();
      resolve(false);
    });
    sock.once("error", () => {
      sock.destroy();
      resolve(false);
    });
    sock.connect(port, "127.0.0.1");
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TorStatus {
  running: boolean;
  bootstrapProgress: number;
  socksPort: number;
}

/**
 * Start the Tor process.
 *
 * Resolves when bootstrap reaches 100 %. Rejects after 60 s timeout or if the
 * binary is missing / the port is already taken.
 */
export async function startTor(): Promise<TorStatus> {
  // Already running?
  if (torProcess && !torProcess.killed) {
    return getTorStatus();
  }

  const torBin = getTorBinaryPath();
  if (!fs.existsSync(torBin)) {
    throw new Error(
      `Tor binary not found at ${torBin}. ` +
      "Download the Tor Expert Bundle and place the tor binary in client/resources/tor/."
    );
  }

  // Check if something else is already on our port
  const portTaken = await isPortInUse(SOCKS_PORT);
  if (portTaken) {
    // Could be a previous Tor instance or Tor Browser — treat as success
    console.log(`[tor] Port ${SOCKS_PORT} already in use — assuming Tor is already running.`);
    bootstrapProgress = 100;
    return getTorStatus();
  }

  const dataDir = getTorDataDir();
  bootstrapProgress = 0;

  return new Promise<TorStatus>((resolve, reject) => {
    const args = [
      "--SocksPort", String(SOCKS_PORT),
      "--DataDirectory", dataDir,
      // Pipe all logs to stdout so we can parse them
      "--Log", "notice stdout",
    ];

    torProcess = spawn(torBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      // On Windows we need to let the child create its own window-less console
      windowsHide: true,
    });

    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Tor failed to bootstrap within ${BOOTSTRAP_TIMEOUT_MS / 1000}s (reached ${bootstrapProgress}%)`));
        // Don't kill — let it keep trying in the background
      }
    }, BOOTSTRAP_TIMEOUT_MS);

    // Parse stdout for bootstrap lines
    torProcess.stdout?.on("data", (chunk: Buffer) => {
      const lines = chunk.toString("utf-8").split("\n");
      for (const line of lines) {
        // Example: "May 18 12:00:00.000 [notice] Bootstrapped 45% (loading_descriptors): Loading relay descriptors"
        const match = line.match(/Bootstrapped\s+(\d+)%\s*\(([^)]*)\)/);
        if (match) {
          bootstrapProgress = parseInt(match[1], 10);
          const summary = match[2];

          // Push progress event to renderer
          mainWindow?.webContents.send("tor:bootstrap-progress", {
            progress: bootstrapProgress,
            summary,
          });

          console.log(`[tor] Bootstrap: ${bootstrapProgress}% (${summary})`);

          if (bootstrapProgress >= 100 && !settled) {
            settled = true;
            clearTimeout(timer);
            resolve(getTorStatus());
          }
        }
      }
    });

    // Log stderr but don't crash
    torProcess.stderr?.on("data", (chunk: Buffer) => {
      console.error(`[tor] stderr: ${chunk.toString("utf-8").trim()}`);
    });

    // Handle process exit
    torProcess.on("exit", (code, signal) => {
      console.log(`[tor] Process exited (code=${code}, signal=${signal})`);
      torProcess = null;
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Tor process exited unexpectedly (code=${code}, signal=${signal})`));
      }
    });

    torProcess.on("error", (err) => {
      console.error(`[tor] Process error: ${err.message}`);
      torProcess = null;
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Failed to start Tor: ${err.message}`));
      }
    });
  });
}

/**
 * Stop the Tor process gracefully.
 */
export async function stopTor(): Promise<void> {
  if (!torProcess || torProcess.killed) {
    torProcess = null;
    bootstrapProgress = 0;
    return;
  }

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      // Force kill if it hasn't exited after 5 s
      if (torProcess && !torProcess.killed) {
        console.log("[tor] Force-killing after 5s timeout");
        torProcess.kill("SIGKILL");
      }
      torProcess = null;
      bootstrapProgress = 0;
      resolve();
    }, 5000);

    torProcess!.on("exit", () => {
      clearTimeout(timeout);
      torProcess = null;
      bootstrapProgress = 0;
      resolve();
    });

    // On Windows process.kill() sends SIGTERM equivalent
    torProcess!.kill();
  });
}

/**
 * Returns whether the Tor process is currently alive.
 */
export function isTorRunning(): boolean {
  return torProcess !== null && !torProcess.killed;
}

/**
 * Returns the current Tor status snapshot.
 */
export function getTorStatus(): TorStatus {
  return {
    running: isTorRunning(),
    bootstrapProgress,
    socksPort: SOCKS_PORT,
  };
}
