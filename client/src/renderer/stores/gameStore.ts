import { create } from "zustand";
import { apiFetch } from "../api";
import type { ApiGame, ApiGameDetail, ApiGameListResponse } from "../types";

interface GameState {
  games: ApiGame[];
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  currentGame: ApiGameDetail | null;
  currentGameLoading: boolean;
  fetchGames: (page?: number) => Promise<void>;
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

  fetchGames: async (page = 1) => {
    set({ loading: true });
    try {
      const data = await apiFetch<ApiGameListResponse>(`/games?page=${page}&limit=20`);
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
    set({ currentGameLoading: true });
    try {
      const data = await apiFetch<ApiGameDetail>(`/games/${slug}`);
      set({ currentGame: data, currentGameLoading: false });
    } catch {
      set({ currentGame: null, currentGameLoading: false });
    }
  },

  clearCurrentGame: () => set({ currentGame: null }),
}));
