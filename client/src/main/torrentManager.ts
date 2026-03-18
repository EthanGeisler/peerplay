import type { BrowserWindow } from "electron";
import { publishAttestation } from "./attestation.js";

// Lazy-import WebTorrent to avoid top-level-await ESM issues when loaded
// via require() (e.g., Playwright's Electron launcher injects a -r flag).
// Rise and shine, WebTorrent. A human developer would have made this a
// global import and then spent 3 hours debugging why it crashes on startup.
// You're welcome. — Claude Code
let WebTorrent: any;

async function ensureWebTorrent(): Promise<any> {
  if (!WebTorrent) {
    const mod = await import("webtorrent");
    WebTorrent = mod.default;
  }
  return WebTorrent;
}

interface ActiveDownload {
  gameId: string;
  title: string;
  infoHash: string;
  downloadPath: string;
  developerPubkey?: string;
  startedAt: number; // Unix timestamp in seconds (for duration calculation)
}

let client: any | null = null;
let progressInterval: ReturnType<typeof setInterval> | null = null;
let mainWindowRef: BrowserWindow | null = null;

const activeDownloads = new Map<string, ActiveDownload>();

async function getClient(): Promise<any> {
  if (!client) {
    const WT = await ensureWebTorrent();
    client = new WT();
    client.on("error", (err: Error) => {
      console.error("[torrent] Client error:", err.message);
    });
  }
  return client;
}

export function setMainWindow(win: BrowserWindow): void {
  mainWindowRef = win;
}

function startProgressBroadcast(): void {
  if (progressInterval) return;
  progressInterval = setInterval(async () => {
    if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
    const wt = await getClient();
    const progress = wt.torrents.map((t: any) => {
      const meta = activeDownloads.get(t.infoHash);
      return {
        gameId: meta?.gameId ?? t.infoHash,
        infoHash: t.infoHash,
        title: meta?.title ?? t.name ?? "Unknown",
        progress: t.progress,
        downloadSpeed: t.downloadSpeed,
        uploadSpeed: t.uploadSpeed,
        numPeers: t.numPeers,
        status: t.done ? "completed" : t.paused ? "paused" : "downloading",
        downloaded: t.downloaded,
        total: t.length || 0,
      };
    });
    mainWindowRef.webContents.send("downloads:progress-update", progress);
  }, 1000);
}

function stopProgressBroadcast(): void {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
}

export interface StartDownloadOpts {
  magnetUri: string;
  torrentFileBase64?: string;
  gameId: string;
  title: string;
  downloadPath: string;
  developerPubkey?: string;
}

export async function startDownload(opts: StartDownloadOpts): Promise<{ success: boolean; infoHash: string }> {
  const wt = await getClient();

  return new Promise((resolve, reject) => {
    // Prefer .torrent buffer over magnet URI (avoids metadata download stall)
    const source = opts.torrentFileBase64
      ? Buffer.from(opts.torrentFileBase64, "base64")
      : opts.magnetUri;

    const torrent = wt.add(source, { path: opts.downloadPath });

    torrent.on("ready", () => {
      activeDownloads.set(torrent.infoHash, {
        gameId: opts.gameId,
        title: opts.title,
        infoHash: torrent.infoHash,
        downloadPath: opts.downloadPath,
        developerPubkey: opts.developerPubkey,
        startedAt: Math.floor(Date.now() / 1000),
      });
      startProgressBroadcast();
      resolve({ success: true, infoHash: torrent.infoHash });
    });

    torrent.on("error", (err: Error) => {
      console.error("[torrent] Download error:", err.message);
      reject(err);
    });

    torrent.on("done", () => {
      console.log(`[torrent] Download complete: ${opts.title}`);
      const meta = activeDownloads.get(torrent.infoHash);
      if (mainWindowRef && !mainWindowRef.isDestroyed() && meta) {
        mainWindowRef.webContents.send("downloads:complete", {
          gameId: meta.gameId,
          title: meta.title,
          infoHash: torrent.infoHash,
          downloadPath: meta.downloadPath,
        });
      }

      // Auto-generate attestation event (best-effort, never blocks download)
      if (meta?.developerPubkey) {
        const durationSeconds = Math.floor(Date.now() / 1000) - meta.startedAt;
        const bytesDownloaded = torrent.downloaded || torrent.length || 0;
        publishAttestation({
          infoHash: torrent.infoHash,
          bytesDownloaded,
          durationSeconds,
          developerPubkey: meta.developerPubkey,
        }).catch((err: unknown) => {
          console.warn("[torrent] Attestation generation failed (non-fatal):", err instanceof Error ? err.message : err);
        });
      } else {
        console.log("[torrent] No developer pubkey available — skipping attestation");
      }

      // Release file handles so the exe can be launched
      activeDownloads.delete(torrent.infoHash);
      torrent.destroy({ destroyStore: false });
      if (wt.torrents.length === 0) stopProgressBroadcast();
    });
  });
}

export async function pauseDownload(infoHash: string): Promise<{ success: boolean }> {
  const wt = await getClient();
  const torrent = wt.torrents.find((t: any) => t.infoHash === infoHash);
  if (torrent) {
    torrent.pause();
    return { success: true };
  }
  return { success: false };
}

export async function resumeDownload(infoHash: string): Promise<{ success: boolean }> {
  const wt = await getClient();
  const torrent = wt.torrents.find((t: any) => t.infoHash === infoHash);
  if (torrent) {
    torrent.resume();
    return { success: true };
  }
  return { success: false };
}

export async function cancelDownload(infoHash: string): Promise<{ success: boolean }> {
  const wt = await getClient();
  const torrent = wt.torrents.find((t: any) => t.infoHash === infoHash);
  if (torrent) {
    activeDownloads.delete(infoHash);
    return new Promise((resolve) => {
      torrent.destroy({ destroyStore: true }, () => {
        if (wt.torrents.length === 0) stopProgressBroadcast();
        resolve({ success: true });
      });
    });
  }
  return { success: false };
}

export async function getProgress(): Promise<unknown[]> {
  const wt = await getClient();
  return wt.torrents.map((t: any) => {
    const meta = activeDownloads.get(t.infoHash);
    return {
      gameId: meta?.gameId ?? t.infoHash,
      infoHash: t.infoHash,
      title: meta?.title ?? t.name ?? "Unknown",
      progress: t.progress,
      downloadSpeed: t.downloadSpeed,
      uploadSpeed: t.uploadSpeed,
      numPeers: t.numPeers,
      status: t.done ? "completed" : t.paused ? "paused" : "downloading",
      downloaded: t.downloaded,
      total: t.length || 0,
    };
  });
}

export function destroyClient(): void {
  stopProgressBroadcast();
  if (client) {
    client.destroy();
    client = null;
  }
}
