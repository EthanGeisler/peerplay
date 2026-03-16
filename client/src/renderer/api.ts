const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://boilerdeck.com/api";

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = (await window.boilerdeck.store.get("refreshToken")) as
    | string
    | null;
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      await window.boilerdeck.store.delete("refreshToken");
      return null;
    }

    const data = await res.json();
    await window.boilerdeck.store.set("refreshToken", data.refreshToken);
    accessToken = data.accessToken;
    return data.accessToken;
  } catch {
    return null;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  let res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // Auto-refresh on 401
  if (res.status === 401 && accessToken) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message || res.statusText, body.code);
  }

  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

/**
 * Fetch raw .torrent file bytes as a base64 string.
 * Uses the same auth + auto-refresh logic as apiFetch.
 */
export async function fetchTorrentFileBase64(gameId: string): Promise<string> {
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  let res = await fetch(`${API_BASE}/torrents/${gameId}/latest/file`, { headers });

  // Auto-refresh on 401
  if (res.status === 401 && accessToken) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await fetch(`${API_BASE}/torrents/${gameId}/latest/file`, { headers });
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message || res.statusText, body.code);
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

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
