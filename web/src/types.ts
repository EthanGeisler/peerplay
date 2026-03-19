export type ContentType = "GAME" | "VIDEO" | "SOFTWARE" | "AUDIO" | "OTHER";

export interface ApiGame {
  id: string;
  slug: string;
  title: string;
  description: string;
  priceCents: number;
  coverImageUrl: string | null;
  eventId?: string | null;
  studioName: string;
  contentType?: ContentType;
  metadata?: Record<string, unknown>;
}

export interface ApiGameDetail extends ApiGame {
  screenshots: string[];
  metadata?: Record<string, unknown>;
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
  email: string | null;
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
    contentType?: ContentType;
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

export interface ProfileData {
  pubkey: string;
  name?: string;
  about?: string;
  picture?: string;
  created_at?: number;
}

// Backwards-compatible aliases
export type ApiListing = ApiGame;
export type ApiListingDetail = ApiGameDetail;
export type ApiListingListResponse = ApiGameListResponse;
