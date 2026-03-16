import { create } from "zustand";
import {
  apiFetch,
  setAccessToken,
  refreshAccessToken,
} from "../api";
import type { ApiUser, ApiAuthResponse } from "../types";

interface AuthState {
  user: ApiUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  loadSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,

  login: async (email: string, password: string) => {
    const data = await apiFetch<ApiAuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    setAccessToken(data.accessToken);
    await window.boilerdeck.store.set("refreshToken", data.refreshToken);
    set({ user: data.user });
  },

  register: async (email: string, password: string, displayName: string) => {
    const data = await apiFetch<ApiAuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, displayName }),
    });

    setAccessToken(data.accessToken);
    await window.boilerdeck.store.set("refreshToken", data.refreshToken);
    set({ user: data.user });
  },

  logout: async () => {
    const refreshToken = (await window.boilerdeck.store.get("refreshToken")) as
      | string
      | null;
    if (refreshToken) {
      apiFetch("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      }).catch(() => {});
    }
    setAccessToken(null);
    await window.boilerdeck.store.delete("refreshToken");
    set({ user: null });
  },

  loadSession: async () => {
    set({ loading: true });
    try {
      const token = await refreshAccessToken();
      if (!token) {
        set({ user: null, loading: false });
        return;
      }
      const user = await apiFetch<ApiUser>("/auth/me");
      set({ user, loading: false });
    } catch {
      setAccessToken(null);
      await window.boilerdeck.store.delete("refreshToken");
      set({ user: null, loading: false });
    }
  },
}));
