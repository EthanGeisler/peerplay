import { create } from "zustand";
import { apiFetch, ApiError } from "../api";
import type { ApiLicense, ApiTorrent, ApiCheckoutResult } from "../types";

interface LibraryState {
  licenses: ApiLicense[];
  loading: boolean;
  checkoutLoading: boolean;
  error: string | null;
  fetchLicenses: () => Promise<void>;
  checkout: (gameId: string) => Promise<ApiCheckoutResult>;
  fetchTorrent: (gameId: string) => Promise<ApiTorrent>;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  licenses: [],
  loading: false,
  checkoutLoading: false,
  error: null,

  fetchLicenses: async () => {
    set({ loading: true, error: null });
    try {
      const data = await apiFetch<{ licenses: ApiLicense[] }>("/licenses");
      set({ licenses: data.licenses, loading: false });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        set({ licenses: [], loading: false });
        return;
      }
      set({ loading: false, error: (err as Error).message });
    }
  },

  checkout: async (gameId) => {
    set({ checkoutLoading: true, error: null });
    try {
      const result = await apiFetch<ApiCheckoutResult>("/payments/checkout", {
        method: "POST",
        body: JSON.stringify({ gameId }),
      });

      if (result.free) {
        // Free game — license granted immediately, re-fetch
        const data = await apiFetch<{ licenses: ApiLicense[] }>("/licenses");
        set({ licenses: data.licenses, checkoutLoading: false });
      } else if (result.checkoutUrl) {
        // Paid game — redirect to Stripe Checkout
        window.location.href = result.checkoutUrl;
        // Don't clear checkoutLoading since we're navigating away
      }

      return result;
    } catch (err) {
      set({ checkoutLoading: false, error: (err as Error).message });
      throw err;
    }
  },

  fetchTorrent: async (gameId) => {
    return apiFetch<ApiTorrent>(`/torrents/${gameId}/latest`);
  },
}));
