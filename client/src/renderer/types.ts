// Types matching server API response shapes — adapted from web/src/types.ts

export interface ApiGame {
  id: string;
  slug: string;
  title: string;
  description: string;
  priceCents: number;
  coverImageUrl: string | null;
  eventId?: string | null;
  studioName: string;
}

export interface ApiGameDetail extends ApiGame {
  screenshots: string[];
  exePath: string | null;
  pubkey?: string | null;
  latestVersion: {
    id: string;
    version: string;
    fileSizeBytes: number;
    changelog: string | null;
    createdAt: string;
    infoHash?: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiUser {
  id: string;
  email: string;
  displayName: string;
  role: "USER" | "DEVELOPER" | "ADMIN";
  nostrPubkey?: string;
  pubkey?: string | null;
  custodyMode?: string;
}

export interface ApiAuthResponse {
  user: ApiUser;
  accessToken: string;
  refreshToken: string;
  mnemonic?: string;
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
  status: string;
  coverImageUrl: string | null;
  screenshots: string[];
  exePath: string | null;
  savePaths: string[];
  createdAt: string;
  updatedAt: string;
  versions: DevGameVersion[];
  licensesCount: number;
  salesCount: number;
}

export interface DevGameForm {
  title: string;
  description: string;
  priceCents: number;
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

export interface ApiReview {
  eventId: string;
  pubkey: string;
  rating: number;
  title: string;
  body: string;
  created_at: number;
}

export interface ApiReviewsResponse {
  reviews: ApiReview[];
  averageRating: number;
  reviewCount: number;
  limit: number;
  offset: number;
}

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

// Client-specific types

export interface InstalledGame {
  gameId: string;
  title: string;
  slug: string;
  installPath: string;
  exePath: string | null;
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
