import { createApiClient, ApiError } from "@boilerdeck/ui-shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://boilerdeck.com/api";

const client = createApiClient(API_BASE, {
  getRefreshToken: async () =>
    (await window.boilerdeck.store.get("refreshToken")) as string | null,
  setRefreshToken: async (token) => {
    if (token) {
      await window.boilerdeck.store.set("refreshToken", token);
    } else {
      await window.boilerdeck.store.delete("refreshToken");
    }
  },
});

export const setAccessToken = client.setAccessToken;
export const getAccessToken = client.getAccessToken;
export const refreshAccessToken = client.refreshAccessToken;
export { ApiError };

/**
 * Check whether API traffic should be routed through the SOCKS5 proxy.
 * Reads the privacy settings from the main process via IPC.
 */
async function shouldProxyApi(): Promise<boolean> {
  try {
    const settings = await window.boilerdeck.privacy.getSettings();
    return settings.mode !== "off" && settings.routeApiTraffic;
  } catch {
    return false;
  }
}

/**
 * Perform an API request through the main-process SOCKS5 proxy via IPC.
 * Mirrors the same auth, 401-retry, JSON-parsing, and error shape as the
 * shared `apiFetch` so callers see identical behaviour regardless of path.
 */
async function proxiedApiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  const accessToken = client.getAccessToken();
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const url = `${API_BASE}${path}`;
  const method = (options.method ?? "GET").toUpperCase();
  const body = options.body as string | undefined;

  let res = await window.boilerdeck.api.proxiedFetch({ url, method, headers, body });

  // Auto-refresh on 401
  if (res.status === 401 && accessToken) {
    const newToken = await client.refreshAccessToken();
    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await window.boilerdeck.api.proxiedFetch({ url, method, headers, body });
    }
  }

  if (res.status < 200 || res.status >= 300) {
    if (res.status === 204) return undefined as T;
    const parsed = (() => {
      try { return JSON.parse(res.body); } catch { return { message: `HTTP ${res.status}` }; }
    })();
    const message = parsed.error?.message || parsed.message || `HTTP ${res.status}`;
    const code = parsed.error?.code || parsed.code;
    throw new ApiError(res.status, message, code);
  }

  if (res.status === 204) return undefined as T;

  return JSON.parse(res.body) as T;
}

/**
 * Smart apiFetch — routes through the SOCKS5 proxy (via IPC) when privacy
 * mode is enabled and routeApiTraffic is true.  Otherwise uses the standard
 * direct fetch path from the shared API client.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  if (await shouldProxyApi()) {
    return proxiedApiFetch<T>(path, options);
  }
  return client.apiFetch<T>(path, options);
}

/**
 * Fetch raw .torrent file bytes as a base64 string.
 * Uses the same auth + auto-refresh logic as apiFetch.
 * Routes through proxy when privacy mode is active.
 */
export async function fetchTorrentFileBase64(gameId: string): Promise<string> {
  const useProxy = await shouldProxyApi();
  const headers: Record<string, string> = {};
  const token = client.getAccessToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = `${API_BASE}/torrents/${gameId}/latest/file`;

  if (useProxy) {
    let res = await window.boilerdeck.api.proxiedFetch({ url, method: "GET", headers });

    // Auto-refresh on 401
    if (res.status === 401 && token) {
      const newToken = await client.refreshAccessToken();
      if (newToken) {
        headers["Authorization"] = `Bearer ${newToken}`;
        res = await window.boilerdeck.api.proxiedFetch({ url, method: "GET", headers });
      }
    }

    if (res.status < 200 || res.status >= 300) {
      const parsed = (() => {
        try { return JSON.parse(res.body); } catch { return { message: `HTTP ${res.status}` }; }
      })();
      const message = parsed.error?.message || parsed.message || `HTTP ${res.status}`;
      const code = parsed.error?.code || parsed.code;
      throw new ApiError(res.status, message, code);
    }

    // The proxied response body is a UTF-8 string of the binary content.
    // Convert to base64.
    return btoa(res.body);
  }

  // Direct fetch path (original logic)
  let res = await fetch(url, { headers });

  // Auto-refresh on 401
  if (res.status === 401 && token) {
    const newToken = await client.refreshAccessToken();
    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await fetch(url, { headers });
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    const message = body.error?.message || body.message || res.statusText;
    const code = body.error?.code || body.code;
    throw new ApiError(res.status, message, code);
  }

  const arrayBuffer = await res.arrayBuffer();
  // Convert ArrayBuffer to base64 string
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
