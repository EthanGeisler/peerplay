// Types matching server API response shapes — adapted from web/src/types.ts

export interface ApiGame {
  id: string;
  slug: string;
  title: string;
  description: string;
  priceCents: number;
  drmTier: "NONE" | "LIGHT" | "ENCRYPTED";
  coverImageUrl: string | null;
  studioName: string;
}

export interface ApiGameDetail extends ApiGame {
  screenshots: string[];
  exePath: string | null;
  latestVersion: {
    id: string;
    version: string;
    fileSizeBytes: number;
    changelog: string | null;
    createdAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiUser {
  id: string;
  email: string;
  displayName: string;
  role: "USER" | "DEVELOPER" | "ADMIN";
}

export interface ApiAuthResponse {
  user: ApiUser;
  accessToken: string;
  refreshToken: string;
}

export interface ApiLicense {
  id: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  createdAt: string;
  game: {
    id: string;
    slug: string;
    title: string;
    coverImageUrl: string | null;
    drmTier: "NONE" | "LIGHT" | "ENCRYPTED";
    studioName: string;
  };
}

export interface ApiTorrent {
  gameId: string;
  versionId: string;
  version: string;
  fileSizeBytes: string | number;
  magnetUri: string;
  infoHash: string;
  encrypted: boolean;
  algorithm?: string;
}

export interface ApiCheckoutResult {
  free: boolean;
  checkoutUrl?: string;
  paymentId: string;
  licenseId?: string;
  gameId: string;
  gameTitle: string;
}

export interface ApiGameListResponse {
  games: ApiGame[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Developer Portal types

export interface Developer {
  id: string;
  studioName: string;
  stripeOnboarded: boolean;
  stripePayoutsEnabled: boolean;
}

export interface DevGameSummary {
  id: string;
  slug: string;
  title: string;
  status: string;
  priceCents: number;
  drmTier: string;
  coverImageUrl: string | null;
  versionsCount: number;
  licensesCount: number;
  salesCount: number;
  createdAt: string;
}

export interface DevGameVersion {
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

export interface DevGameData {
  id: string;
  slug: string;
  title: string;
  description: string;
  priceCents: number;
  drmTier: string;
  status: string;
  coverImageUrl: string | null;
  screenshots: string[];
  exePath: string | null;
  savePaths: string[];
  createdAt: string;
  updatedAt: string;
  versions: DevGameVersion[];
  encryptionKey: { id: string; algorithm: string; createdAt: string } | null;
  licensesCount: number;
  salesCount: number;
}

export interface DevGameForm {
  title: string;
  description: string;
  priceCents: number;
  drmTier: "NONE" | "LIGHT" | "ENCRYPTED";
  exePath: string;
  coverImageUrl: string;
}

export interface DevGameDir {
  name: string;
  files: string[];
}

export interface DevDetectResult {
  directory: string;
  executables: string[];
  recommended: string | null;
}

// Client-specific types

export interface InstalledGame {
  gameId: string;
  title: string;
  slug: string;
  installPath: string;
  exePath: string | null;
  drmTier: "NONE" | "LIGHT" | "ENCRYPTED";
  version: string;
  coverImageUrl: string | null;
  installedAt: string;
}

export type DownloadStatus = "queued" | "downloading" | "paused" | "completed" | "error";

export interface DownloadProgress {
  gameId: string;
  infoHash: string;
  title: string;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  numPeers: number;
  status: DownloadStatus;
  downloaded: number;
  total: number;
}
