import { create } from "zustand";
import { apiFetch, setAccessToken, refreshAccessToken, ApiError } from "../api";
import type { ApiUser, ApiAuthResponse } from "../types";
import { generateKeypairInBrowser, deriveFromMnemonic, signChallenge } from "../nostrCrypto";

interface AuthState {
  user: ApiUser | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<string | undefined>;
  register: (email: string, password: string, displayName: string) => Promise<string | undefined>;
  registerWithNostr: (displayName: string) => Promise<string>;
  loginWithNostr: (mnemonicPhrase: string) => Promise<void>;
  logout: () => Promise<void>;
  loadSession: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  error: null,

  login: async (email, password) => {
    set({ error: null });
    try {
      const data = await apiFetch<ApiAuthResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setAccessToken(data.accessToken);
      localStorage.setItem("pp_refresh_token", data.refreshToken);
      set({ user: data.user });
      return data.mnemonic;
    } catch (err) {
      set({
        error: err instanceof ApiError ? err.message : "Login failed",
      });
      throw err;
    }
  },

  register: async (email, password, displayName) => {
    set({ error: null });
    try {
      const data = await apiFetch<ApiAuthResponse>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, displayName }),
      });
      setAccessToken(data.accessToken);
      localStorage.setItem("pp_refresh_token", data.refreshToken);
      set({ user: data.user });
      return data.mnemonic;
    } catch (err) {
      set({
        error: err instanceof ApiError ? err.message : "Registration failed",
      });
      throw err;
    }
  },

  registerWithNostr: async (displayName: string) => {
    set({ error: null });
    try {
      const { mnemonic, pubkeyHex, privateKey } = generateKeypairInBrowser();

      const { challenge } = await apiFetch<{ challenge: string; expiresAt: string }>("/auth/challenge");
      const signature = signChallenge(challenge, privateKey);

      const data = await apiFetch<ApiAuthResponse>("/auth/register/pubkey", {
        method: "POST",
        body: JSON.stringify({ pubkey: pubkeyHex, displayName, challenge, signature }),
      });

      setAccessToken(data.accessToken);
      localStorage.setItem("pp_refresh_token", data.refreshToken);
      set({ user: data.user });
      return mnemonic;
    } catch (err) {
      set({
        error: err instanceof ApiError ? err.message : "Registration failed",
      });
      throw err;
    }
  },

  loginWithNostr: async (mnemonicPhrase: string) => {
    set({ error: null });
    try {
      const { pubkeyHex, privateKey } = deriveFromMnemonic(mnemonicPhrase.trim());

      const { challenge } = await apiFetch<{ challenge: string; expiresAt: string }>("/auth/challenge");
      const signature = signChallenge(challenge, privateKey);

      const data = await apiFetch<ApiAuthResponse>("/auth/login/pubkey", {
        method: "POST",
        body: JSON.stringify({ pubkey: pubkeyHex, challenge, signature }),
      });

      setAccessToken(data.accessToken);
      localStorage.setItem("pp_refresh_token", data.refreshToken);
      set({ user: data.user });
    } catch (err) {
      set({
        error: err instanceof ApiError ? err.message : "Sign in failed",
      });
      throw err;
    }
  },

  logout: async () => {
    try {
      const refreshToken = localStorage.getItem("pp_refresh_token");
      await apiFetch("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Logout best-effort
    }
    setAccessToken(null);
    localStorage.removeItem("pp_refresh_token");
    set({ user: null, error: null });
  },

  loadSession: async () => {
    const token = localStorage.getItem("pp_refresh_token");
    if (!token) {
      set({ loading: false });
      return;
    }

    try {
      const newToken = await refreshAccessToken();
      if (!newToken) {
        set({ loading: false });
        return;
      }

      const user = await apiFetch<ApiUser>("/auth/me");
      set({ user, loading: false });
    } catch {
      localStorage.removeItem("pp_refresh_token");
      set({ loading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
