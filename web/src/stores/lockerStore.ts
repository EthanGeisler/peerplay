import { create } from "zustand";
import { apiFetch, ApiError } from "../api";

// ─── Types (mirroring server's LockerEntry + ListResult) ─────────

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

export interface LockerQuota {
  used: number; // bytes
  max: number; // bytes
}

export type ViewMode = "grid" | "list";
export type SortField = "name" | "size" | "date";
export type SortDir = "asc" | "desc";

// ─── Store ───────────────────────────────────────────────────────

interface LockerState {
  entries: LockerEntry[];
  quota: LockerQuota | null;
  isLoading: boolean;
  error: string | null;
  viewMode: ViewMode;
  searchQuery: string;
  sortField: SortField;
  sortDir: SortDir;

  fetchEntries: () => Promise<void>;
  setViewMode: (mode: ViewMode) => void;
  setSearchQuery: (query: string) => void;
  setSortField: (field: SortField) => void;
  setSortDir: (dir: SortDir) => void;
  clearError: () => void;
}

export const useLockerStore = create<LockerState>((set) => ({
  entries: [],
  quota: null,
  isLoading: false,
  error: null,
  viewMode: "list",
  searchQuery: "",
  sortField: "date",
  sortDir: "desc",

  fetchEntries: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiFetch<{ entries: LockerEntry[]; quota: LockerQuota }>(
        "/locker/entries",
      );
      set({
        entries: Array.isArray(data.entries) ? data.entries : [],
        quota: data.quota ?? null,
        isLoading: false,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        set({ entries: [], quota: null, isLoading: false });
        return;
      }
      set({ isLoading: false, error: (err as Error).message });
    }
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSortField: (field) => set({ sortField: field }),
  setSortDir: (dir) => set({ sortDir: dir }),
  clearError: () => set({ error: null }),
}));
