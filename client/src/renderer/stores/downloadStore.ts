import { create } from "zustand";
import { useInstalledStore } from "./installedStore";
import type { DownloadProgress, InstalledGame } from "../types";

// Metadata needed to register a game as installed when download completes
interface DownloadMeta {
  gameId: string;
  title: string;
  slug: string;
  exePath: string | null;
  version: string;
  coverImageUrl: string | null;
  downloadPath: string;
}

// Module-level map — survives store re-renders, doesn't need to be reactive
const downloadMeta = new Map<string, DownloadMeta>();

interface DownloadState {
  downloads: Map<string, DownloadProgress>;
  startDownload: (opts: {
    magnetUri: string;
    torrentFileBase64?: string;
    gameId: string;
    title: string;
    downloadPath: string;
    meta: DownloadMeta;
  }) => Promise<void>;
  pauseDownload: (infoHash: string) => Promise<void>;
  resumeDownload: (infoHash: string) => Promise<void>;
  cancelDownload: (infoHash: string) => Promise<void>;
  initListeners: () => void;
  cleanupListeners: () => void;
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  downloads: new Map(),

  startDownload: async (opts) => {
    // Store metadata for when download completes
    downloadMeta.set(opts.gameId, opts.meta);

    const result = await window.boilerdeck.downloads.startDownload({
      magnetUri: opts.magnetUri,
      torrentFileBase64: opts.torrentFileBase64,
      gameId: opts.gameId,
      title: opts.title,
      downloadPath: opts.downloadPath,
    });
    if (result.success && result.infoHash) {
      const downloads = new Map(get().downloads);
      downloads.set(result.infoHash, {
        gameId: opts.gameId,
        infoHash: result.infoHash,
        title: opts.title,
        progress: 0,
        downloadSpeed: 0,
        uploadSpeed: 0,
        numPeers: 0,
        status: "downloading",
        downloaded: 0,
        total: 0,
      });
      set({ downloads });
    }
  },

  pauseDownload: async (infoHash) => {
    await window.boilerdeck.downloads.pauseDownload(infoHash);
  },

  resumeDownload: async (infoHash) => {
    await window.boilerdeck.downloads.resumeDownload(infoHash);
  },

  cancelDownload: async (infoHash) => {
    await window.boilerdeck.downloads.cancelDownload(infoHash);
    const downloads = new Map(get().downloads);
    downloads.delete(infoHash);
    set({ downloads });
  },

  initListeners: () => {
    // Progress updates (push from main, every 1s)
    window.boilerdeck.downloads.onProgressUpdate((data) => {
      const progressList = data as DownloadProgress[];
      const downloads = new Map<string, DownloadProgress>();
      for (const p of progressList) {
        downloads.set(p.infoHash, p);
      }
      set({ downloads });
    });

    // Download completion — register as installed
    window.boilerdeck.downloads.onComplete(async (data) => {
      const meta = downloadMeta.get(data.gameId);
      if (!meta) return;

      const installed: InstalledGame = {
        gameId: meta.gameId,
        title: meta.title,
        slug: meta.slug,
        installPath: meta.downloadPath,
        exePath: meta.exePath,
        version: meta.version,
        coverImageUrl: meta.coverImageUrl,
        installedAt: new Date().toISOString(),
      };
      await useInstalledStore.getState().markInstalled(installed);
      downloadMeta.delete(data.gameId);
    });
  },

  cleanupListeners: () => {
    window.boilerdeck.downloads.removeProgressListener();
    window.boilerdeck.downloads.removeCompleteListener();
  },
}));
