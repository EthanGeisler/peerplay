import { create } from "zustand";
import {
  apiFetch,
  setAccessToken,
  refreshAccessToken,
} from "../api";
import type { ApiUser, ApiAuthResponse, Developer } from "../types";

interface AuthState {
  user: ApiUser | null;
  developer: Developer | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  registerDeveloper: (studioName: string) => Promise<void>;
  logout: () => Promise<void>;
  loadSession: () => Promise<void>;
  clearError: () => void;
}

async function loadDeveloperProfile(set: (s: Partial<AuthState>) => void) {
  try {
    const dev = await apiFetch<Developer>("/developer/profile");
    set({ developer: dev });
  } catch {
    // Not a developer yet — that's fine
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  developer: null,
  loading: true,
  error: null,

  login: async (email: string, password: string) => {
    set({ error: null });
    const data = await apiFetch<ApiAuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    setAccessToken(data.accessToken);
    await window.boilerdeck.store.set("refreshToken", data.refreshToken);
    set({ user: data.user });

    if (data.user.role === "DEVELOPER" || data.user.role === "ADMIN") {
      await loadDeveloperProfile(set);
    }
  },

  register: async (email: string, password: string, displayName: string) => {
    set({ error: null });
    const data = await apiFetch<ApiAuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, displayName }),
    });

    setAccessToken(data.accessToken);
    await window.boilerdeck.store.set("refreshToken", data.refreshToken);
    set({ user: data.user });
  },

  registerDeveloper: async (studioName: string) => {
    set({ error: null });
    try {
      const dev = await apiFetch<Developer>("/developer/register", {
        method: "POST",
        body: JSON.stringify({ studioName }),
      });
      set({ developer: dev });

      // Refresh token to get a new JWT with the DEVELOPER role
      await refreshAccessToken();

      // Reload user to get updated role
      const user = await apiFetch<ApiUser>("/auth/me");
      set({ user });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Developer registration failed";
      set({ error: message });
    }
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
    set({ user: null, developer: null });
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

      if (user.role === "DEVELOPER" || user.role === "ADMIN") {
        await loadDeveloperProfile(set);
      }
    } catch {
      setAccessToken(null);
      await window.boilerdeck.store.delete("refreshToken");
      set({ user: null, loading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
