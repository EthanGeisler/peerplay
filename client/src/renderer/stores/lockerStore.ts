import { create } from "zustand";
import { getAccessToken } from "../api";

export type DownloadStatus = "available" | "downloading" | "downloaded" | "seeding" | "error";
export type ViewMode = "grid" | "list";
export type SortField = "name" | "size" | "date";
export type SortDir = "asc" | "desc";

export interface LockerEntry {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  sha256: string;
  infoHash: string;
  magnetUri: string;
  createdAt: number;
  tags: string[];
  version: number;
}

export interface LockerIndexEntry {
  entryId: string;
  filename: string;
  size: number;
  mimeType: string;
  sha256: string;
  infoHash: string;
  magnetUri: string;
  tags: string[];
  downloadStatus: DownloadStatus;
  localPath: string | null;
  lastSynced: number;
  createdAt: number;
  version: number;
}

export interface LockerQuota {
  used: number;
  max: number;
}

interface UploadQueueItem {
  id: string;
  filename: string;
  percent: number;
  bytesUploaded: number;
  bytesTotal: number;
}

interface DownloadQueueItem {
  entryId: string;
  percent: number;
  bytesDownloaded: number;
  bytesTotal: number;
}

interface LockerState {
  entries: LockerIndexEntry[];
  uploadQueue: UploadQueueItem[];
  downloadQueue: DownloadQueueItem[];
  quota: LockerQuota;
  viewMode: ViewMode;
  searchQuery: string;
  selectedTags: string[];
  sortField: SortField;
  sortDir: SortDir;
  isLoading: boolean;
  error: string | null;

  fetchEntries: () => Promise<void>;
  uploadFile: (tags?: string[]) => Promise<void>;
  uploadDirectory: (tags?: string[]) => Promise<void>;
  downloadEntry: (entryId: string) => Promise<void>;
  deleteEntry: (entryId: string) => Promise<void>;
  setViewMode: (mode: ViewMode) => void;
  setSearchQuery: (query: string) => void;
  setSelectedTags: (tags: string[]) => void;
  setSortField: (field: SortField) => void;
  setSortDir: (dir: SortDir) => void;
  refreshQuota: () => Promise<void>;
  updateUploadProgress: (data: { entryId: string; percent: number; bytesUploaded: number; bytesTotal: number }) => void;
  updateDownloadProgress: (data: { entryId: string; percent: number; bytesDownloaded: number; bytesTotal: number }) => void;
  handleSyncUpdate: (entries: LockerIndexEntry[]) => void;
  clearError: () => void;
}

function mergeEntries(
  local: LockerIndexEntry[],
  remote: LockerEntry[],
): LockerIndexEntry[] {
  const map = new Map<string, LockerIndexEntry>();
  for (const e of local) {
    map.set(e.entryId, e);
  }
  for (const r of remote) {
    const existing = map.get(r.id);
    if (existing) {
      // Keep local download status, update metadata
      map.set(r.id, {
        ...existing,
        filename: r.filename,
        size: r.size,
        mimeType: r.mimeType,
        sha256: r.sha256,
        infoHash: r.infoHash,
        magnetUri: r.magnetUri,
        tags: r.tags,
        version: r.version,
        createdAt: r.createdAt,
      });
    } else {
      map.set(r.id, {
        entryId: r.id,
        filename: r.filename,
        size: r.size,
        mimeType: r.mimeType,
        sha256: r.sha256,
        infoHash: r.infoHash,
        magnetUri: r.magnetUri,
        tags: r.tags,
        downloadStatus: "available",
        localPath: null,
        lastSynced: Date.now(),
        createdAt: r.createdAt,
        version: r.version,
      });
    }
  }
  return Array.from(map.values());
}

export const useLockerStore = create<LockerState>((set, get) => ({
  entries: [],
  uploadQueue: [],
  downloadQueue: [],
  quota: { used: 0, max: 50 * 1024 * 1024 * 1024 },
  viewMode: "grid",
  searchQuery: "",
  selectedTags: [],
  sortField: "date",
  sortDir: "desc",
  isLoading: false,
  error: null,

  fetchEntries: async () => {
    set({ isLoading: true, error: null });
    try {
      const token = getAccessToken();
      if (!token) {
        set({ isLoading: false, error: "Not authenticated" });
        return;
      }

      // Fetch remote entries and local entries in parallel
      const [remoteResult, localEntries] = await Promise.all([
        window.boilerdeck.locker.getEntries(token),
        window.boilerdeck.locker.getLocalEntries(),
      ]);

      const merged = mergeEntries(localEntries, remoteResult.entries);
      set({
        entries: merged,
        quota: remoteResult.quota,
        isLoading: false,
      });
    } catch (err) {
      // Fall back to local entries only
      try {
        const localEntries = await window.boilerdeck.locker.getLocalEntries();
        set({ entries: localEntries, isLoading: false, error: String(err) });
      } catch {
        set({ isLoading: false, error: err instanceof Error ? err.message : "Failed to load entries" });
      }
    }
  },

  uploadFile: async (tags) => {
    const token = getAccessToken();
    if (!token) {
      set({ error: "Not authenticated" });
      return;
    }
    try {
      const result = await window.boilerdeck.locker.uploadFile(token, tags);
      if (result) {
        // Re-fetch entries to pick up the new one
        await get().fetchEntries();
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Upload failed" });
    }
  },

  uploadDirectory: async (tags) => {
    const token = getAccessToken();
    if (!token) {
      set({ error: "Not authenticated" });
      return;
    }
    try {
      const result = await window.boilerdeck.locker.uploadDirectory(token, tags);
      if (result) {
        await get().fetchEntries();
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Upload failed" });
    }
  },

  downloadEntry: async (entryId) => {
    const token = getAccessToken();
    if (!token) {
      set({ error: "Not authenticated" });
      return;
    }

    // Add to download queue
    set((s) => ({
      downloadQueue: [...s.downloadQueue, { entryId, percent: 0, bytesDownloaded: 0, bytesTotal: 0 }],
      entries: s.entries.map((e) =>
        e.entryId === entryId ? { ...e, downloadStatus: "downloading" as DownloadStatus } : e,
      ),
    }));

    try {
      const localPath = await window.boilerdeck.locker.downloadEntry(token, entryId);
      set((s) => ({
        downloadQueue: s.downloadQueue.filter((d) => d.entryId !== entryId),
        entries: s.entries.map((e) =>
          e.entryId === entryId ? { ...e, downloadStatus: "downloaded" as DownloadStatus, localPath } : e,
        ),
      }));
    } catch (err) {
      set((s) => ({
        downloadQueue: s.downloadQueue.filter((d) => d.entryId !== entryId),
        entries: s.entries.map((e) =>
          e.entryId === entryId ? { ...e, downloadStatus: "error" as DownloadStatus } : e,
        ),
        error: err instanceof Error ? err.message : "Download failed",
      }));
    }
  },

  deleteEntry: async (entryId) => {
    const token = getAccessToken();
    if (!token) {
      set({ error: "Not authenticated" });
      return;
    }
    try {
      await window.boilerdeck.locker.deleteEntry(token, entryId);
      set((s) => ({
        entries: s.entries.filter((e) => e.entryId !== entryId),
      }));
      // Refresh quota
      await get().refreshQuota();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Delete failed" });
    }
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedTags: (tags) => set({ selectedTags: tags }),
  setSortField: (field) => set({ sortField: field }),
  setSortDir: (dir) => set({ sortDir: dir }),

  refreshQuota: async () => {
    const token = getAccessToken();
    if (!token) return;
    try {
      const result = await window.boilerdeck.locker.getEntries(token);
      set({ quota: result.quota });
    } catch {
      // Silently fail quota refresh
    }
  },

  updateUploadProgress: (data) => {
    set((s) => ({
      uploadQueue: s.uploadQueue.map((u) =>
        u.id === data.entryId
          ? { ...u, percent: data.percent, bytesUploaded: data.bytesUploaded, bytesTotal: data.bytesTotal }
          : u,
      ),
    }));
  },

  updateDownloadProgress: (data) => {
    set((s) => ({
      downloadQueue: s.downloadQueue.map((d) =>
        d.entryId === data.entryId
          ? { ...d, percent: data.percent, bytesDownloaded: data.bytesDownloaded, bytesTotal: data.bytesTotal }
          : d,
      ),
    }));
  },

  handleSyncUpdate: (entries) => {
    set({ entries });
  },

  clearError: () => set({ error: null }),
}));
