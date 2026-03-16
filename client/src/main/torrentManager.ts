import WebTorrent, { type Torrent } from "webtorrent";
import type { BrowserWindow } from "electron";

interface ActiveDownload {
  gameId: string;
  title: string;
  infoHash: string;
  downloadPath: string;
}

let client: InstanceType<typeof WebTorrent> | null = null;
let progressInterval: ReturnType<typeof setInterval> | null = null;
let mainWindowRef: BrowserWindow | null = null;

const activeDownloads = new Map<string, ActiveDownload>();

function getClient(): InstanceType<typeof WebTorrent> {
  if (!client) {
    client = new WebTorrent();
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
  progressInterval = setInterval(() => {
    if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
    const wt = getClient();
    const progress = wt.torrents.map((t: Torrent) => {
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
}

export function startDownload(opts: StartDownloadOpts): Promise<{ success: boolean; infoHash: string }> {
  return new Promise((resolve, reject) => {
    const wt = getClient();

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
    });
  });
}

export function pauseDownload(infoHash: string): { success: boolean } {
  const wt = getClient();
  const torrent = wt.torrents.find((t: Torrent) => t.infoHash === infoHash);
  if (torrent) {
    torrent.pause();
    return { success: true };
  }
  return { success: false };
}

export function resumeDownload(infoHash: string): { success: boolean } {
  const wt = getClient();
  const torrent = wt.torrents.find((t: Torrent) => t.infoHash === infoHash);
  if (torrent) {
    torrent.resume();
    return { success: true };
  }
  return { success: false };
}

export function cancelDownload(infoHash: string): Promise<{ success: boolean }> {
  return new Promise((resolve) => {
    const wt = getClient();
    const torrent = wt.torrents.find((t: Torrent) => t.infoHash === infoHash);
    if (torrent) {
      activeDownloads.delete(infoHash);
      torrent.destroy({ destroyStore: true }, () => {
        if (wt.torrents.length === 0) stopProgressBroadcast();
        resolve({ success: true });
      });
    } else {
      resolve({ success: false });
    }
  });
}

export function getProgress(): unknown[] {
  const wt = getClient();
  return wt.torrents.map((t) => {
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
