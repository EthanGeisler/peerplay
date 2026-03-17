import { create } from "zustand";
import type { InstalledGame } from "../types";

interface InstalledState {
  installedGames: Record<string, InstalledGame>;
  loaded: boolean;
  loadInstalled: () => Promise<void>;
  markInstalled: (game: InstalledGame) => Promise<void>;
  uninstall: (gameId: string) => Promise<{ success: boolean; error?: string }>;
  launch: (gameId: string) => Promise<{ success: boolean; error?: string }>;
}

export const useInstalledStore = create<InstalledState>((set, get) => ({
  installedGames: {},
  loaded: false,

  loadInstalled: async () => {
    const data = (await window.boilerdeck.store.get("installedGames")) as
      | Record<string, InstalledGame>
      | null;
    set({ installedGames: data ?? {}, loaded: true });
  },

  markInstalled: async (game: InstalledGame) => {
    const updated = { ...get().installedGames, [game.gameId]: game };
    set({ installedGames: updated });
    await window.boilerdeck.store.set("installedGames", updated);
  },

  uninstall: async (gameId: string) => {
    const game = get().installedGames[gameId];
    if (!game) return { success: false, error: "Game not found in registry" };

    const result = await window.boilerdeck.games.uninstall(game.installPath);
    if (result.success) {
      const updated = { ...get().installedGames };
      delete updated[gameId];
      set({ installedGames: updated });
      await window.boilerdeck.store.set("installedGames", updated);
    }
    return result;
  },

  launch: async (gameId: string) => {
    const game = get().installedGames[gameId];
    if (!game) return { success: false, error: "Game not installed" };
    if (!game.exePath) return { success: false, error: "No executable path known" };

    return window.boilerdeck.games.launch({
      gameId: game.gameId,
      installPath: game.installPath,
      exePath: game.exePath,
    });
  },
}));
