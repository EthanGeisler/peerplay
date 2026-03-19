import { create } from "zustand";
import { apiFetch } from "../api";
import type { ApiGame, ApiGameDetail, ApiGameListResponse, ContentType } from "../types";

interface GameState {
  games: ApiGame[];
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  currentGame: ApiGameDetail | null;
  currentGameLoading: boolean;
  currentGameError: string | null;
  fetchGames: (page?: number, contentType?: ContentType) => Promise<void>;
  fetchGameBySlug: (slug: string) => Promise<void>;
  clearCurrentGame: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  games: [],
  total: 0,
  page: 1,
  totalPages: 1,
  loading: false,
  currentGame: null,
  currentGameLoading: false,
  currentGameError: null,

  fetchGames: async (page = 1, contentType?: ContentType) => {
    set({ loading: true });
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (contentType) params.set("contentType", contentType);
      const data = await apiFetch<ApiGameListResponse>(`/listings?${params}`);
      set({
        games: data.games,
        total: data.total,
        page: data.page,
        totalPages: data.totalPages,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  fetchGameBySlug: async (slug: string) => {
    set({ currentGameLoading: true, currentGameError: null });
    try {
      const data = await apiFetch<ApiGameDetail>(`/listings/${slug}`);
      set({ currentGame: data, currentGameLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load listing";
      console.error("[gameStore] fetchGameBySlug failed:", message);
      set({ currentGame: null, currentGameLoading: false, currentGameError: message });
    }
  },

  clearCurrentGame: () => set({ currentGame: null }),
}));
