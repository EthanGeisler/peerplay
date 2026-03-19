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
  login: (email: string, password: string) => Promise<string | undefined>;
  loginWithPubkey: () => Promise<void>;
  loginWithMnemonic: (mnemonic: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<string | undefined>;
  registerSelfCustody: (email: string, password: string, displayName: string) => Promise<string>;
  registerWithNostr: (displayName: string) => Promise<string>;
  registerWithExistingNostr: (displayName: string, mnemonic: string) => Promise<void>;
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
    if (data.user.custodyMode) {
      await window.boilerdeck.store.set("custodyMode", data.user.custodyMode);
    }
    set({ user: data.user });

    if (data.user.role === "DEVELOPER" || data.user.role === "ADMIN") {
      await loadDeveloperProfile(set);
    }

    return data.mnemonic;
  },

  register: async (email: string, password: string, displayName: string) => {
    set({ error: null });
    const data = await apiFetch<ApiAuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, displayName }),
    });

    setAccessToken(data.accessToken);
    await window.boilerdeck.store.set("refreshToken", data.refreshToken);
    if (data.user.custodyMode) {
      await window.boilerdeck.store.set("custodyMode", data.user.custodyMode);
    }
    set({ user: data.user });

    return data.mnemonic;
  },

  registerSelfCustody: async (email: string, password: string, displayName: string) => {
    set({ error: null });
    // Generate keypair locally in main process
    const { mnemonic, pubkeyHex } = await window.boilerdeck.crypto.generateKeypair();

    // Register with server (server stores pubkey only, no encrypted key)
    const data = await apiFetch<ApiAuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, displayName, pubkey: pubkeyHex }),
    });

    setAccessToken(data.accessToken);
    await window.boilerdeck.store.set("refreshToken", data.refreshToken);
    if (data.user.custodyMode) {
      await window.boilerdeck.store.set("custodyMode", data.user.custodyMode);
    }
    set({ user: data.user });

    return mnemonic;
  },

  loginWithPubkey: async () => {
    set({ error: null });
    // Get challenge from server
    const { challenge } = await apiFetch<{ challenge: string; expiresAt: string }>("/auth/challenge");

    // Sign challenge in main process using stored private key
    const { signature, pubkeyHex } = await window.boilerdeck.crypto.signChallenge(challenge);

    // Login with pubkey
    const data = await apiFetch<ApiAuthResponse>("/auth/login/pubkey", {
      method: "POST",
      body: JSON.stringify({ pubkey: pubkeyHex, challenge, signature }),
    });

    setAccessToken(data.accessToken);
    await window.boilerdeck.store.set("refreshToken", data.refreshToken);
    if (data.user.custodyMode) {
      await window.boilerdeck.store.set("custodyMode", data.user.custodyMode);
    }
    set({ user: data.user });

    if (data.user.role === "DEVELOPER" || data.user.role === "ADMIN") {
      await loadDeveloperProfile(set);
    }
  },

  registerWithNostr: async (displayName: string) => {
    set({ error: null });
    // Generate keypair locally in main process
    const { mnemonic, pubkeyHex } = await window.boilerdeck.crypto.generateKeypair();

    // Get challenge + sign it
    const { challenge } = await apiFetch<{ challenge: string; expiresAt: string }>("/auth/challenge");
    const { signature } = await window.boilerdeck.crypto.signChallenge(challenge);

    // Register with server (no email/password)
    const data = await apiFetch<ApiAuthResponse>("/auth/register/pubkey", {
      method: "POST",
      body: JSON.stringify({ pubkey: pubkeyHex, displayName, challenge, signature }),
    });

    setAccessToken(data.accessToken);
    await window.boilerdeck.store.set("refreshToken", data.refreshToken);
    if (data.user.custodyMode) {
      await window.boilerdeck.store.set("custodyMode", data.user.custodyMode);
    }
    set({ user: data.user });

    return mnemonic;
  },

  registerWithExistingNostr: async (displayName: string, mnemonic: string) => {
    set({ error: null });
    // Import mnemonic → derives keypair, caches private key in electron-store
    const { pubkeyHex } = await window.boilerdeck.crypto.importMnemonic(mnemonic.trim());

    // Get challenge + sign it (now using the cached key)
    const { challenge } = await apiFetch<{ challenge: string; expiresAt: string }>("/auth/challenge");
    const { signature } = await window.boilerdeck.crypto.signChallenge(challenge);

    // Register with server (no email/password)
    const data = await apiFetch<ApiAuthResponse>("/auth/register/pubkey", {
      method: "POST",
      body: JSON.stringify({ pubkey: pubkeyHex, displayName, challenge, signature }),
    });

    setAccessToken(data.accessToken);
    await window.boilerdeck.store.set("refreshToken", data.refreshToken);
    if (data.user.custodyMode) {
      await window.boilerdeck.store.set("custodyMode", data.user.custodyMode);
    }
    set({ user: data.user });
  },

  loginWithMnemonic: async (mnemonic: string) => {
    set({ error: null });
    // Import mnemonic → derives keypair, caches private key in electron-store
    const { pubkeyHex } = await window.boilerdeck.crypto.importMnemonic(mnemonic.trim());

    // Get challenge + sign it (now using the cached key)
    const { challenge } = await apiFetch<{ challenge: string; expiresAt: string }>("/auth/challenge");
    const { signature } = await window.boilerdeck.crypto.signChallenge(challenge);

    // Login with pubkey
    const data = await apiFetch<ApiAuthResponse>("/auth/login/pubkey", {
      method: "POST",
      body: JSON.stringify({ pubkey: pubkeyHex, challenge, signature }),
    });

    setAccessToken(data.accessToken);
    await window.boilerdeck.store.set("refreshToken", data.refreshToken);
    if (data.user.custodyMode) {
      await window.boilerdeck.store.set("custodyMode", data.user.custodyMode);
    }
    set({ user: data.user });

    if (data.user.role === "DEVELOPER" || data.user.role === "ADMIN") {
      await loadDeveloperProfile(set);
    }
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
    await window.boilerdeck.store.delete("custodyMode");
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
      if (user.custodyMode) {
        await window.boilerdeck.store.set("custodyMode", user.custodyMode);
      }
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
