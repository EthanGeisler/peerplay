import { create } from 'zustand';

type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'error';

interface DownloadEntry {
  gameId: string;
  title: string;
  progress: number;
  speed: number;
  status: DownloadStatus;
}

interface DownloadState {
  downloads: Map<string, DownloadEntry>;
  addDownload: (gameId: string, title: string, magnetUri: string) => void;
  pauseDownload: (gameId: string) => void;
  removeDownload: (gameId: string) => void;
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  downloads: new Map(),

  addDownload: (gameId: string, title: string, _magnetUri: string) => {
    const downloads = new Map(get().downloads);
    downloads.set(gameId, {
      gameId,
      title,
      progress: 0,
      speed: 0,
      status: 'queued',
    });
    set({ downloads });
    // TODO: call window.boilerdeck.downloads.startDownload(magnetUri)
  },

  pauseDownload: (gameId: string) => {
    const downloads = new Map(get().downloads);
    const entry = downloads.get(gameId);
    if (entry) {
      downloads.set(gameId, { ...entry, status: 'paused', speed: 0 });
      set({ downloads });
    }
    // TODO: call window.boilerdeck.downloads.pauseDownload(infoHash)
  },

  removeDownload: (gameId: string) => {
    const downloads = new Map(get().downloads);
    downloads.delete(gameId);
    set({ downloads });
  },
}));
