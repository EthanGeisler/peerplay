export interface ApiGame {
  id: string;
  slug: string;
  title: string;
  description: string;
  priceCents: number;
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
  nostrPubkey?: string;
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
