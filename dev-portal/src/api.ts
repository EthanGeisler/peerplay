import { createApiClient, ApiError } from "@boilerdeck/ui-shared";

const API_BASE = "/api";

const client = createApiClient(API_BASE, {
  getRefreshToken: async () => localStorage.getItem("pp_refresh_token"),
  setRefreshToken: async (token) => {
    if (token) {
      localStorage.setItem("pp_refresh_token", token);
    } else {
      localStorage.removeItem("pp_refresh_token");
    }
  },
});

export const setAccessToken = client.setAccessToken;
export const getAccessToken = client.getAccessToken;
export const refreshAccessToken = client.refreshAccessToken;
export const apiFetch = client.apiFetch;
export { ApiError };

/** Redirect to Stripe Connect onboarding. Returns false if no URL was returned. */
export async function redirectToStripeOnboard(): Promise<boolean> {
  const data = await apiFetch<{ url?: string; status?: string }>("/developer/stripe/onboard");
  if (data.url) {
    window.location.assign(data.url);
    return true;
  }
  return false;
}

export function apiUpload<T = unknown>(
  path: string,
  formData: FormData,
  onProgress?: (percent: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}${path}`);

    if (client.getAccessToken()) {
      xhr.setRequestHeader("Authorization", `Bearer ${client.getAccessToken()}`);
    }
    // Do NOT set Content-Type — browser auto-sets multipart boundary

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = async () => {
      if (xhr.status === 401 && client.getAccessToken()) {
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
              let body: Record<string, unknown> = {};
              try { body = JSON.parse(retryXhr.responseText); } catch { /* use empty */ }
              const msg = (body.error as Record<string, unknown>)?.message || body.message || retryXhr.statusText;
              reject(new ApiError(retryXhr.status, String(msg)));
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
          message = (body.error as Record<string, unknown>)?.message as string || body.message || message;
        } catch { /* use statusText */ }
        reject(new ApiError(xhr.status, message));
      }
    };

    xhr.onerror = () => reject(new ApiError(0, "Network error"));
    xhr.send(formData);
  });
}
