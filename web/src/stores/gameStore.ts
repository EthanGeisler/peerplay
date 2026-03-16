import { create } from "zustand";
import { apiFetch } from "../api";
import type { ApiGame, ApiGameDetail, ApiGameListResponse } from "../types";

interface GameState {
  games: ApiGame[];
  currentGame: ApiGameDetail | null;
  loading: boolean;
  error: string | null;
  fetchGames: () => Promise<void>;
  fetchGameBySlug: (slug: string) => Promise<void>;
}

export const useGameStore = create<GameState>((set) => ({
  games: [],
  currentGame: null,
  loading: false,
  error: null,

  fetchGames: async () => {
    set({ loading: true, error: null });
    try {
      const data = await apiFetch<ApiGameListResponse>("/games?limit=50");
      set({ games: data.games, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  fetchGameBySlug: async (slug) => {
    set({ loading: true, error: null, currentGame: null });
    try {
      const game = await apiFetch<ApiGameDetail>(`/games/${slug}`);
      set({ currentGame: game, loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },
}));
