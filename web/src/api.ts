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
