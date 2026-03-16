import { create } from 'zustand';
import { apiClient } from '../api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api';

interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,

  login: async (email: string, password: string) => {
    const data = await apiClient.post<{
      user: User;
      accessToken: string;
      refreshToken: string;
    }>(`${API_BASE_URL}/auth/login`, { email, password });

    set({
      user: data.user,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
  },

  register: async (email: string, password: string, displayName: string) => {
    const data = await apiClient.post<{
      user: User;
      accessToken: string;
      refreshToken: string;
    }>(`${API_BASE_URL}/auth/register`, { email, password, displayName });

    set({
      user: data.user,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
  },

  logout: () => {
    set({ user: null, accessToken: null, refreshToken: null });
  },

  refresh: async () => {
    const { refreshToken } = get();
    if (!refreshToken) throw new Error('No refresh token');

    const data = await apiClient.post<{
      accessToken: string;
      refreshToken: string;
    }>(`${API_BASE_URL}/auth/refresh`, { refreshToken });

    set({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
  },
}));
