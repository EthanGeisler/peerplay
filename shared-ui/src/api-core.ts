/**
 * Shared API client core — used by web, dev-portal, and Electron client.
 *
 * Platform-specific token storage is injected via the TokenStorage adapter
 * passed to `createApiClient()`.
 */

// ---------------------------------------------------------------------------
// Token storage adapter — each frontend provides its own implementation
// ---------------------------------------------------------------------------

export interface TokenStorage {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string | null): Promise<void>;
}

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// API client factory
// ---------------------------------------------------------------------------

export interface ApiClient {
  /** Replace the in-memory access token. */
  setAccessToken(token: string | null): void;
  /** Read the current in-memory access token. */
  getAccessToken(): string | null;
  /** Refresh the access token using the stored refresh token. Serialized. */
  refreshAccessToken(): Promise<string | null>;
  /** Fetch JSON from the API with automatic 401 retry. */
  apiFetch<T = unknown>(path: string, options?: RequestInit): Promise<T>;
}

export function createApiClient(
  apiBase: string,
  storage: TokenStorage,
): ApiClient {
  let accessToken: string | null = null;

  // Serialize concurrent refresh calls — only one in-flight at a time
  let refreshPromise: Promise<string | null> | null = null;

  function setAccessToken(token: string | null) {
    accessToken = token;
  }

  function getAccessToken(): string | null {
    return accessToken;
  }

  async function refreshAccessToken(): Promise<string | null> {
    if (refreshPromise) return refreshPromise;

    refreshPromise = doRefresh();
    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  async function doRefresh(): Promise<string | null> {
    const refreshToken = await storage.getRefreshToken();
    if (!refreshToken) return null;

    try {
      const res = await fetch(`${apiBase}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        await storage.setRefreshToken(null);
        return null;
      }

      const data = await res.json();
      await storage.setRefreshToken(data.refreshToken);
      accessToken = data.accessToken;
      return data.accessToken;
    } catch {
      return null;
    }
  }

  async function apiFetch<T = unknown>(
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

    let res = await fetch(`${apiBase}${path}`, { ...options, headers });

    // Auto-refresh on 401
    if (res.status === 401 && accessToken) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        headers["Authorization"] = `Bearer ${newToken}`;
        res = await fetch(`${apiBase}${path}`, { ...options, headers });
      }
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      const message = body.error?.message || body.message || res.statusText;
      const code = body.error?.code || body.code;
      throw new ApiError(res.status, message, code);
    }

    if (res.status === 204) return undefined as T;

    return res.json() as Promise<T>;
  }

  return { setAccessToken, getAccessToken, refreshAccessToken, apiFetch };
}
