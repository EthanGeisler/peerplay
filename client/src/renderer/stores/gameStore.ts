import { create } from "zustand";
import { apiFetch } from "../api";
import type { ApiGame, ApiGameDetail, ApiGameListResponse, ContentType } from "../types";

/** Convert a relay WebSocket URL to its HTTP origin. */
function relayToHttpUrl(relayUrl: string): string {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  // Remove /relay path suffix if present
  url.pathname = url.pathname.replace(/\/relay\/?$/, "");
  return url.origin;
}

/** Relay listing shape returned by GET /api/relay/listings */
interface RelayListing {
  id: string;
  slug: string;
  title: string;
  description: string;
  priceCents: number;
  contentType?: ContentType;
  coverImageUrl?: string | null;
  creatorPublicKey?: string;
  signature?: string;
  createdAt?: string;
  studioName?: string;
}

interface RelayListingsResponse {
  listings: RelayListing[];
  total: number;
}

/** Fetch listings from a single relay's HTTP API. */
async function fetchFromRelay(
  relayUrl: string,
  contentType?: ContentType,
): Promise<ApiGame[]> {
  const httpBase = relayToHttpUrl(relayUrl);
  const params = new URLSearchParams({ limit: "100" });
  if (contentType) params.set("contentType", contentType);

  const res = await fetch(`${httpBase}/api/relay/listings?${params}`);
  if (!res.ok) return [];

  const data: RelayListingsResponse = await res.json();
  if (!data.listings || !Array.isArray(data.listings)) return [];

  return data.listings.map((l) => ({
    id: l.id,
    slug: l.slug,
    title: l.title,
    description: l.description,
    priceCents: l.priceCents,
    coverImageUrl: l.coverImageUrl ?? null,
    studioName: l.studioName ?? "",
    contentType: l.contentType,
    relaySource: relayUrl,
  }));
}

/** Default relay URL — used for dedup preference. */
const DEFAULT_RELAY_URL = "wss://boilerdeck.com/relay";

/** Format a cache timestamp as a human-readable relative string. */
function formatCacheAge(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface GameState {
  games: ApiGame[];
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  currentGame: ApiGameDetail | null;
  currentGameLoading: boolean;
  currentGameError: string | null;
  sovereignMode: boolean;
  gatewayDown: boolean;
  usingCache: boolean;
  cacheAge: string | null;
  fetchGames: (page?: number, contentType?: ContentType) => Promise<void>;
  fetchGameBySlug: (slug: string) => Promise<void>;
  clearCurrentGame: () => void;
  checkSovereignMode: () => Promise<void>;
}

export const useGameStore = create<GameState>((set) => ({
  games: [],
  total: 0,
  page: 1,
  totalPages: 1,
  loading: false,
  currentGame: null,
  currentGameLoading: false,
  currentGameError: null,
  sovereignMode: false,
  gatewayDown: false,
  usingCache: false,
  cacheAge: null,

  checkSovereignMode: async () => {
    try {
      if (window.boilerdeck?.sovereignty) {
        const mode = await window.boilerdeck.sovereignty.getMode();
        set({ sovereignMode: mode });
      }
    } catch {
      set({ sovereignMode: false });
    }
  },

  fetchGames: async (page = 1, contentType?: ContentType) => {
    set({ loading: true });
    try {
      // Check sovereign mode
      let isSovereign = false;
      try {
        if (window.boilerdeck?.sovereignty) {
          isSovereign = await window.boilerdeck.sovereignty.getMode();
          set({ sovereignMode: isSovereign });
        }
      } catch {
        // Not in Electron or sovereignty unavailable
      }

      let fetchedGames: ApiGame[] | null = null;

      if (isSovereign && window.boilerdeck?.relays) {
        // Sovereign mode: fetch from all enabled relays in parallel
        const relayList = await window.boilerdeck.relays.list();
        const enabledRelays = relayList.filter((r) => r.enabled);

        if (enabledRelays.length === 0) {
          // No relays enabled — fall back to gateway
          const params = new URLSearchParams({ page: String(page), limit: "20" });
          if (contentType) params.set("contentType", contentType);
          const data = await apiFetch<ApiGameListResponse>(`/listings?${params}`);
          fetchedGames = data.games;
          set({
            games: data.games,
            total: data.total,
            page: data.page,
            totalPages: data.totalPages,
            loading: false,
            gatewayDown: false,
            usingCache: false,
            cacheAge: null,
          });
        } else {
          const results = await Promise.allSettled(
            enabledRelays.map((r) => fetchFromRelay(r.url, contentType)),
          );

          // Merge and deduplicate by slug
          const slugMap = new Map<string, ApiGame>();

          for (const result of results) {
            if (result.status !== "fulfilled") continue;
            for (const game of result.value) {
              const existing = slugMap.get(game.slug);
              if (!existing) {
                slugMap.set(game.slug, game);
              } else if (
                game.relaySource === DEFAULT_RELAY_URL &&
                existing.relaySource !== DEFAULT_RELAY_URL
              ) {
                slugMap.set(game.slug, game);
              }
            }
          }

          const merged = Array.from(slugMap.values()).sort((a, b) =>
            a.title.localeCompare(b.title),
          );

          fetchedGames = merged;
          set({
            games: merged,
            total: merged.length,
            page: 1,
            totalPages: 1,
            loading: false,
            gatewayDown: false,
            usingCache: false,
            cacheAge: null,
          });
        }
      } else {
        // Normal mode: use gateway API
        const params = new URLSearchParams({ page: String(page), limit: "20" });
        if (contentType) params.set("contentType", contentType);
        const data = await apiFetch<ApiGameListResponse>(`/listings?${params}`);
        fetchedGames = data.games;
        set({
          games: data.games,
          total: data.total,
          page: data.page,
          totalPages: data.totalPages,
          loading: false,
          gatewayDown: false,
          usingCache: false,
          cacheAge: null,
        });
      }

      // Cache successful fetch
      if (fetchedGames && fetchedGames.length > 0 && window.boilerdeck?.cache) {
        window.boilerdeck.cache.setListings(fetchedGames).catch(() => {
          // Caching is best-effort
        });
      }
    } catch {
      // Fetch failed — try loading from cache
      let loaded = false;
      try {
        if (window.boilerdeck?.cache) {
          const cached = await window.boilerdeck.cache.getListings();
          if (cached && cached.listings && cached.listings.length > 0) {
            set({
              games: cached.listings as ApiGame[],
              total: cached.listings.length,
              page: 1,
              totalPages: 1,
              loading: false,
              gatewayDown: true,
              usingCache: true,
              cacheAge: formatCacheAge(cached.cachedAt),
            });
            loaded = true;
          }
        }
      } catch {
        // Cache read also failed
      }

      if (!loaded) {
        set({
          games: [],
          total: 0,
          loading: false,
          gatewayDown: true,
          usingCache: false,
          cacheAge: null,
        });
      }
    }
  },

  fetchGameBySlug: async (slug: string) => {
    set({ currentGameLoading: true, currentGameError: null });
    try {
      const data = await apiFetch<ApiGameDetail>(`/listings/${slug}`);
      set({ currentGame: data, currentGameLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load listing";
      console.error("[gameStore] fetchGameBySlug failed:", message);
      set({ currentGame: null, currentGameLoading: false, currentGameError: message });
    }
  },

  clearCurrentGame: () => set({ currentGame: null }),
}));
