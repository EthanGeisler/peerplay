import { create } from "zustand";
import { MOCK_GAMES, MOCK_LIBRARY } from "../data/mock";
import type { Game, OwnedGame } from "../data/mock";

interface AppState {
  user: { email: string; displayName: string } | null;
  library: OwnedGame[];
  cart: string[];
  login: (email: string) => void;
  logout: () => void;
  purchase: (gameId: string, editionId?: string) => void;
  isOwned: (gameId: string) => boolean;
  getGame: (slug: string) => Game | undefined;
  getOwnedGames: () => Game[];
  addToCart: (gameId: string) => void;
  removeFromCart: (gameId: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  library: [...MOCK_LIBRARY],
  cart: [],

  login: (email) => {
    set({ user: { email, displayName: email.split("@")[0] } });
  },

  logout: () => {
    set({ user: null });
  },

  purchase: (gameId, editionId?) => {
    const { library } = get();
    if (library.some((l) => l.gameId === gameId)) return;
    set({
      library: [...library, { gameId, editionId, purchasedAt: new Date().toISOString() }],
      cart: get().cart.filter((id) => id !== gameId),
    });
  },

  isOwned: (gameId) => {
    return get().library.some((l) => l.gameId === gameId);
  },

  getGame: (slug) => {
    return MOCK_GAMES.find((g) => g.slug === slug);
  },

  getOwnedGames: () => {
    const { library } = get();
    return library
      .map((l) => MOCK_GAMES.find((g) => g.id === l.gameId))
      .filter((g): g is Game => !!g);
  },

  addToCart: (gameId) => {
    const { cart } = get();
    if (!cart.includes(gameId)) {
      set({ cart: [...cart, gameId] });
    }
  },

  removeFromCart: (gameId) => {
    set({ cart: get().cart.filter((id) => id !== gameId) });
  },
}));
