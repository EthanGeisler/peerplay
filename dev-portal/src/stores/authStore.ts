import { create } from "zustand";
import { apiFetch, setAccessToken } from "../api";

interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

interface Developer {
  id: string;
  studioName: string;
  stripeOnboarded: boolean;
}

interface AuthState {
  user: User | null;
  developer: Developer | null;
  loading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  registerDeveloper: (studioName: string) => Promise<void>;
  logout: () => void;
  loadSession: () => Promise<void>;
  clearError: () => void;
}

async function loadDeveloperProfile(set: (s: Partial<AuthState>) => void) {
  try {
    const dev = await apiFetch<Developer>("/developer/profile");
    set({ developer: dev });
  } catch {
    // Not a developer yet
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  developer: null,
  loading: true,
  error: null,

  login: async (email, password) => {
    set({ error: null, loading: true });
    try {
      const data = await apiFetch<{
        accessToken: string;
        refreshToken: string;
        user: User;
      }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      setAccessToken(data.accessToken);
      localStorage.setItem("pp_refresh_token", data.refreshToken);
      set({ user: data.user, loading: false });

      if (data.user.role === "DEVELOPER" || data.user.role === "ADMIN") {
        await loadDeveloperProfile(set);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Login failed";
      set({ error: message, loading: false });
    }
  },

  register: async (email, password, displayName) => {
    set({ error: null, loading: true });
    try {
      const data = await apiFetch<{
        accessToken: string;
        refreshToken: string;
        user: User;
      }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, displayName }),
      });

      setAccessToken(data.accessToken);
      localStorage.setItem("pp_refresh_token", data.refreshToken);
      set({ user: data.user, loading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Registration failed";
      set({ error: message, loading: false });
    }
  },

  registerDeveloper: async (studioName) => {
    set({ error: null });
    try {
      const dev = await apiFetch<Developer>("/developer/register", {
        method: "POST",
        body: JSON.stringify({ studioName }),
      });
      set({ developer: dev });

      // Reload user to get updated role
      const user = await apiFetch<User>("/auth/me");
      set({ user });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Developer registration failed";
      set({ error: message });
    }
  },

  logout: () => {
    const refreshToken = localStorage.getItem("pp_refresh_token");
    if (refreshToken) {
      apiFetch("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      }).catch(() => {});
    }
    setAccessToken(null);
    localStorage.removeItem("pp_refresh_token");
    set({ user: null, developer: null, loading: false });
  },

  loadSession: async () => {
    const refreshToken = localStorage.getItem("pp_refresh_token");
    if (!refreshToken) {
      set({ loading: false });
      return;
    }

    try {
      const data = await apiFetch<{
        accessToken: string;
        refreshToken: string;
      }>("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });

      setAccessToken(data.accessToken);
      localStorage.setItem("pp_refresh_token", data.refreshToken);

      const user = await apiFetch<User>("/auth/me");
      set({ user, loading: false });

      if (user.role === "DEVELOPER" || user.role === "ADMIN") {
        await loadDeveloperProfile(set);
      }
    } catch {
      localStorage.removeItem("pp_refresh_token");
      set({ loading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
