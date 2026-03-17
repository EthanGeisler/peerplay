import { getAccessToken, refreshAccessToken, apiFetch, ApiError } from "./api";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "https://boilerdeck.com/api";

/**
 * Upload a FormData payload with XHR progress tracking.
 * Uses the same token management as apiFetch (IPC store-backed).
 */
export function apiUpload<T = unknown>(
  path: string,
  formData: FormData,
  onProgress?: (percent: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const send = (token: string | null) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}${path}`);

      if (token) {
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      }

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = async () => {
        if (xhr.status === 401 && token) {
          // Token expired — refresh and retry once
          const newToken = await refreshAccessToken();
          if (newToken) {
            send(newToken);
            return;
          }
          reject(new ApiError(401, "Unauthorized"));
          return;
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            resolve(undefined as T);
          }
        } else {
          let message = xhr.statusText;
          try {
            const body = JSON.parse(xhr.responseText);
            message = body.error?.message || body.message || message;
          } catch {
            // keep statusText
          }
          reject(new ApiError(xhr.status, message));
        }
      };

      xhr.onerror = () => reject(new ApiError(0, "Network error"));
      xhr.send(formData);
    };

    send(getAccessToken());
  });
}

/**
 * Open Stripe Connect onboarding in the system browser.
 * Returns true if the URL was opened, false if no URL was returned.
 */
export async function openStripeOnboard(): Promise<boolean> {
  const data = await apiFetch<{ url?: string; status?: string }>("/developer/stripe/onboard");
  if (data.url) {
    await window.boilerdeck.shell.openExternal(data.url);
    return true;
  }
  return false;
}
