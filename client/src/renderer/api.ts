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
export const apiFetch = client.apiFetch;
export { ApiError };

/**
 * Fetch raw .torrent file bytes as a base64 string.
 * Uses the same auth + auto-refresh logic as apiFetch.
 */
export async function fetchTorrentFileBase64(gameId: string): Promise<string> {
  const headers: Record<string, string> = {};
  const token = client.getAccessToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res = await fetch(`${API_BASE}/torrents/${gameId}/latest/file`, { headers });

  // Auto-refresh on 401
  if (res.status === 401 && token) {
    const newToken = await client.refreshAccessToken();
    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await fetch(`${API_BASE}/torrents/${gameId}/latest/file`, { headers });
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
