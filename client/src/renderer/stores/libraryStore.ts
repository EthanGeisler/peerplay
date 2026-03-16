import { create } from "zustand";
import { apiFetch } from "../api";
import type { ApiLicense, ApiTorrent, ApiCheckoutResult } from "../types";

interface LibraryState {
  licenses: ApiLicense[];
  loading: boolean;
  checkoutLoading: boolean;
  fetchLicenses: () => Promise<void>;
  checkout: (gameId: string) => Promise<ApiCheckoutResult>;
  fetchTorrent: (gameId: string) => Promise<ApiTorrent>;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  licenses: [],
  loading: false,
  checkoutLoading: false,

  fetchLicenses: async () => {
    set({ loading: true });
    try {
      const data = await apiFetch<ApiLicense[]>("/licenses");
      set({ licenses: data, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  checkout: async (gameId: string) => {
    set({ checkoutLoading: true });
    try {
      const result = await apiFetch<ApiCheckoutResult>("/payments/checkout", {
        method: "POST",
        body: JSON.stringify({ gameId }),
      });
      // If free, license was created immediately — refresh licenses
      if (result.free) {
        const licenses = await apiFetch<ApiLicense[]>("/licenses");
        set({ licenses, checkoutLoading: false });
      } else {
        set({ checkoutLoading: false });
      }
      return result;
    } catch (err) {
      set({ checkoutLoading: false });
      throw err;
    }
  },

  fetchTorrent: async (gameId: string) => {
    return apiFetch<ApiTorrent>(`/torrents/${gameId}/latest`);
  },
}));
