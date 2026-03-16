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
