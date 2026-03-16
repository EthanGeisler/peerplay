const API_BASE = "/api";

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem("pp_refresh_token");
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      localStorage.removeItem("pp_refresh_token");
      return null;
    }

    const data = await res.json();
    localStorage.setItem("pp_refresh_token", data.refreshToken);
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

  return res.json() as Promise<T>;
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

export function apiUpload<T = unknown>(
  path: string,
  formData: FormData,
  onProgress?: (percent: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}${path}`);

    if (accessToken) {
      xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    }
    // Do NOT set Content-Type — browser auto-sets multipart boundary

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = async () => {
      if (xhr.status === 401 && accessToken) {
        // Try token refresh and retry
        const newToken = await refreshAccessToken();
        if (newToken) {
          const retryXhr = new XMLHttpRequest();
          retryXhr.open("POST", `${API_BASE}${path}`);
          retryXhr.setRequestHeader("Authorization", `Bearer ${newToken}`);
          retryXhr.upload.onprogress = xhr.upload.onprogress;
          retryXhr.onload = () => {
            if (retryXhr.status >= 200 && retryXhr.status < 300) {
              resolve(JSON.parse(retryXhr.responseText));
            } else {
              const body = JSON.parse(retryXhr.responseText).catch?.(() => ({})) ?? {};
              reject(new ApiError(retryXhr.status, body.message || retryXhr.statusText));
            }
          };
          retryXhr.onerror = () => reject(new ApiError(0, "Network error"));
          retryXhr.send(formData);
          return;
        }
        reject(new ApiError(401, "Unauthorized"));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        let message = xhr.statusText;
        try {
          const body = JSON.parse(xhr.responseText);
          message = body.message || message;
        } catch { /* use statusText */ }
        reject(new ApiError(xhr.status, message));
      }
    };

    xhr.onerror = () => reject(new ApiError(0, "Network error"));
    xhr.send(formData);
  });
}
