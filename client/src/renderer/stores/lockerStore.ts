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

interface RendererUploadQueueItem {
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

export interface SharedEntry {
  entry: LockerEntry;
  senderPubkey: string;
}

export interface ConnectionStatus {
  serverOnline: boolean;
  relayConnected: boolean;
  lastSynced: number;
  uploadQueueCount: number;
}

export interface UploadQueueItem {
  id: string;
  filePath: string;
  tags: string[];
  addedAt: number;
  retryCount: number;
  lastError: string | null;
  lastRetryAt: number | null;
  permanentlyFailed: boolean;
}

interface LockerState {
  entries: LockerIndexEntry[];
  uploadQueue: RendererUploadQueueItem[];
  downloadQueue: DownloadQueueItem[];
  quota: LockerQuota;
  viewMode: ViewMode;
  searchQuery: string;
  selectedTags: string[];
  sortField: SortField;
  sortDir: SortDir;
  isLoading: boolean;
  error: string | null;
  sharedWithMe: SharedEntry[];
  sharedWithMeLoading: boolean;
  connectionStatus: ConnectionStatus;
  offlineUploadQueue: UploadQueueItem[];
  dismissedBanners: Set<string>;

  fetchEntries: () => Promise<void>;
  uploadFile: (tags?: string[]) => Promise<void>;
  uploadDirectory: (tags?: string[]) => Promise<void>;
  downloadEntry: (entryId: string) => Promise<void>;
  deleteEntry: (entryId: string) => Promise<void>;
  shareEntry: (entryId: string, recipientPubkey: string) => Promise<void>;
  fetchSharedWithMe: () => Promise<void>;
  revokeShare: (shareId: string) => Promise<void>;
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
  fetchConnectionStatus: () => Promise<void>;
  fetchOfflineQueue: () => Promise<void>;
  retryQueue: () => Promise<void>;
  clearQueueItem: (id: string) => Promise<void>;
  exportIndex: () => Promise<void>;
  dismissBanner: (key: string) => void;
  resetBanners: () => void;
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
  sharedWithMe: [],
  sharedWithMeLoading: false,
  connectionStatus: { serverOnline: true, relayConnected: false, lastSynced: 0, uploadQueueCount: 0 },
  offlineUploadQueue: [],
  dismissedBanners: new Set<string>(),

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

  shareEntry: async (entryId, recipientPubkey) => {
    const token = getAccessToken();
    if (!token) {
      set({ error: "Not authenticated" });
      return;
    }
    try {
      await window.boilerdeck.locker.shareEntry(token, entryId, recipientPubkey);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Share failed" });
    }
  },

  fetchSharedWithMe: async () => {
    const token = getAccessToken();
    if (!token) return;
    set({ sharedWithMeLoading: true });
    try {
      const result = await window.boilerdeck.locker.getSharedWithMe(token);
      const shared: SharedEntry[] = (Array.isArray(result.entries) ? result.entries : []).map((entry) => ({
        entry,
        senderPubkey: result.sharedFrom[entry.id] || "unknown",
      }));
      set({ sharedWithMe: shared, sharedWithMeLoading: false });
    } catch (err) {
      set({ sharedWithMeLoading: false, error: err instanceof Error ? err.message : "Failed to load shared entries" });
    }
  },

  revokeShare: async (shareId) => {
    const token = getAccessToken();
    if (!token) {
      set({ error: "Not authenticated" });
      return;
    }
    try {
      await window.boilerdeck.locker.revokeShare(token, shareId);
      // Remove from local state — shareId isn't directly stored, so re-fetch
      await get().fetchSharedWithMe();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Revoke failed" });
    }
  },

  clearError: () => set({ error: null }),

  fetchConnectionStatus: async () => {
    try {
      const status = await window.boilerdeck.locker.getConnectionStatus();
      set({ connectionStatus: status });
    } catch {
      // Silently fail
    }
  },

  fetchOfflineQueue: async () => {
    try {
      const items = await window.boilerdeck.locker.getUploadQueue();
      set({ offlineUploadQueue: items });
    } catch {
      // Silently fail
    }
  },

  retryQueue: async () => {
    try {
      await window.boilerdeck.locker.retryQueue();
      // Refresh queue and entries after retry
      await get().fetchOfflineQueue();
      await get().fetchEntries();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Retry failed" });
    }
  },

  clearQueueItem: async (id) => {
    try {
      await window.boilerdeck.locker.clearQueueItem(id);
      set((s) => ({
        offlineUploadQueue: s.offlineUploadQueue.filter((item) => item.id !== id),
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to clear queue item" });
    }
  },

  exportIndex: async () => {
    try {
      const result = await window.boilerdeck.locker.exportIndex();
      if (!result.success) {
        // User cancelled — not an error
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Export failed" });
    }
  },

  dismissBanner: (key) => {
    set((s) => {
      const next = new Set(s.dismissedBanners);
      next.add(key);
      return { dismissedBanners: next };
    });
  },

  resetBanners: () => set({ dismissedBanners: new Set<string>() }),
}));
