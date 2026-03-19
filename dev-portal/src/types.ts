// ──────────────────────────────────────────────
// Dev-Portal shared types
// ──────────────────────────────────────────────

export type ContentType = "GAME" | "VIDEO" | "SOFTWARE" | "AUDIO" | "OTHER";

// ── Auth types ──────────────────────────────

export interface User {
  id: string;
  email: string | null;
  displayName: string;
  role: string;
}

export interface Developer {
  id: string;
  studioName: string;
  stripeOnboarded: boolean;
  stripePayoutsEnabled: boolean;
}

export interface AuthState {
  user: User | null;
  developer: Developer | null;
  loading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  registerDeveloper: (studioName: string) => Promise<void>;
  logout: () => void;
  loadSession: () => Promise<void>;
  clearError: () => void;
}

// ── Game types ──────────────────────────────

export interface GameForm {
  title: string;
  description: string;
  priceCents: number;
  exePath: string;
  coverImageUrl: string;
  contentType?: ContentType;
  metadata?: Record<string, unknown>;
}

export interface GameDir {
  name: string;
  files: string[];
}

export interface DetectResult {
  directory: string;
  executables: string[];
  recommended: string | null;
}

export interface GameVersion {
  id: string;
  version: string;
  status: string;
  fileSizeBytes: number;
  changelog: string;
  createdAt: string;
  torrent: {
    id: string;
    infoHash: string;
    magnetUri: string;
    createdAt: string;
  } | null;
}

export interface GameData {
  id: string;
  slug: string;
  title: string;
  description: string;
  priceCents: number;
  status: string;
  coverImageUrl: string | null;
  screenshots: string[];
  exePath: string | null;
  contentType?: ContentType;
  metadata?: Record<string, unknown>;
  savePaths: string[];
  createdAt: string;
  updatedAt: string;
  versions: GameVersion[];
  licensesCount: number;
  salesCount: number;
}

export interface GameSummary {
  id: string;
  slug: string;
  title: string;
  status: string;
  priceCents: number;
  coverImageUrl: string | null;
  contentType?: ContentType;
  metadata?: Record<string, unknown>;
  versionsCount: number;
  licensesCount: number;
  salesCount: number;
  createdAt: string;
}
