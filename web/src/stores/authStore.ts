import { create } from "zustand";
import { apiFetch, setAccessToken, ApiError } from "../api";
import type { ApiUser, ApiAuthResponse } from "../types";

interface AuthState {
  user: ApiUser | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  loadSession: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  error: null,

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const data = await apiFetch<ApiAuthResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setAccessToken(data.accessToken);
      localStorage.setItem("pp_refresh_token", data.refreshToken);
      set({ user: data.user, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof ApiError ? err.message : "Login failed",
      });
      throw err;
    }
  },

  register: async (email, password, displayName) => {
    set({ loading: true, error: null });
    try {
      const data = await apiFetch<ApiAuthResponse>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, displayName }),
      });
      setAccessToken(data.accessToken);
      localStorage.setItem("pp_refresh_token", data.refreshToken);
      set({ user: data.user, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof ApiError ? err.message : "Registration failed",
      });
      throw err;
    }
  },

  logout: async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // Logout best-effort
    }
    setAccessToken(null);
    localStorage.removeItem("pp_refresh_token");
    set({ user: null, error: null });
  },

  loadSession: async () => {
    const refreshToken = localStorage.getItem("pp_refresh_token");
    if (!refreshToken) {
      set({ loading: false });
      return;
    }

    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        localStorage.removeItem("pp_refresh_token");
        set({ loading: false });
        return;
      }

      const data = await res.json();
      setAccessToken(data.accessToken);
      localStorage.setItem("pp_refresh_token", data.refreshToken);

      const user = await apiFetch<ApiUser>("/auth/me");
      set({ user, loading: false });
    } catch {
      localStorage.removeItem("pp_refresh_token");
      set({ loading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
