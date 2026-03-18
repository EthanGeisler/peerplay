import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useGameStore } from "../stores/gameStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useDownloadStore } from "../stores/downloadStore";
import { useAuthStore } from "../stores/authStore";
import { fetchTorrentFileBase64, apiFetch } from "../api";
import { formatPrice, formatSize, PLACEHOLDER_COVER, resolveCoverUrl } from "../utils";
import type { ApiReviewsResponse } from "../types";
import { ReviewSection } from "../components/ReviewSection";
import { ReviewForm } from "../components/ReviewForm";

const styles = {
  back: {
    background: "none",
    border: "none",
    color: "#e94560",
    cursor: "pointer",
    fontSize: 14,
    marginBottom: 16,
    padding: 0,
  } as React.CSSProperties,
  cover: {
    width: "100%",
    maxWidth: 600,
    height: 280,
    objectFit: "cover",
    borderRadius: 8,
    marginBottom: 24,
  } as React.CSSProperties,
  title: {
    fontSize: 32,
    fontWeight: 700,
    color: "#fff",
    marginBottom: 8,
  } as React.CSSProperties,
  studio: {
    fontSize: 14,
    color: "#888",
    marginBottom: 16,
  } as React.CSSProperties,
  description: {
    fontSize: 15,
    color: "#ccc",
    lineHeight: 1.6,
    marginBottom: 24,
    maxWidth: 600,
  } as React.CSSProperties,
  infoRow: {
    display: "flex",
    gap: 24,
    marginBottom: 24,
    flexWrap: "wrap",
  } as React.CSSProperties,
  infoBadge: {
    padding: "6px 14px",
    borderRadius: 4,
    fontSize: 13,
    backgroundColor: "#16213e",
    border: "1px solid #0f3460",
    color: "#e0e0e0",
  } as React.CSSProperties,
  price: {
    fontSize: 24,
    fontWeight: 700,
    color: "#e94560",
    marginBottom: 16,
  } as React.CSSProperties,
  actionBtn: {
    padding: "12px 32px",
    fontSize: 15,
    fontWeight: 600,
    backgroundColor: "#e94560",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
  } as React.CSSProperties,
  ownedBadge: {
    padding: "12px 32px",
    fontSize: 15,
    fontWeight: 600,
    backgroundColor: "#16213e",
    color: "#4ade80",
    border: "1px solid #4ade80",
    borderRadius: 4,
  } as React.CSSProperties,
  loading: {
    color: "#888",
    fontSize: 16,
    marginTop: 40,
    textAlign: "center",
  } as React.CSSProperties,
};

export function GameDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const currentGame = useGameStore((s) => s.currentGame);
  const currentGameLoading = useGameStore((s) => s.currentGameLoading);
  const currentGameError = useGameStore((s) => s.currentGameError);
  const fetchGameBySlug = useGameStore((s) => s.fetchGameBySlug);
  const clearCurrentGame = useGameStore((s) => s.clearCurrentGame);

  const licenses = useLibraryStore((s) => s.licenses);
  const checkoutLoading = useLibraryStore((s) => s.checkoutLoading);
  const checkout = useLibraryStore((s) => s.checkout);
  const fetchLicenses = useLibraryStore((s) => s.fetchLicenses);

  const user = useAuthStore((s) => s.user);

  const [error, setError] = useState("");
  const [reviewRefreshKey, setReviewRefreshKey] = useState(0);
  const [hasReviewed, setHasReviewed] = useState(false);

  useEffect(() => {
    if (slug) fetchGameBySlug(slug);
    return () => clearCurrentGame();
  }, [slug, fetchGameBySlug, clearCurrentGame]);

  useEffect(() => {
    if (user) fetchLicenses();
  }, [user, fetchLicenses]);

  // Check if user has already reviewed this game
  useEffect(() => {
    if (!slug || !user?.pubkey) {
      setHasReviewed(false);
      return;
    }
    apiFetch<ApiReviewsResponse>(`/games/${slug}/reviews?limit=100&offset=0`)
      .then((data) => {
        const userPubkey = user.pubkey || user.nostrPubkey;
        const alreadyReviewed = data.reviews.some((r) => r.pubkey === userPubkey);
        setHasReviewed(alreadyReviewed);
      })
      .catch(() => setHasReviewed(false));
  }, [slug, user, reviewRefreshKey]);

  if (currentGameLoading || !currentGame) {
    return (
      <div>
        <button style={styles.back} onClick={() => navigate("/")}>
          &larr; Back to Store
        </button>
        {currentGameLoading ? (
          <p style={styles.loading}>Loading...</p>
        ) : (
          <div style={{ textAlign: "center", marginTop: 40 }}>
            <p style={{ color: "#fff", fontSize: 18, marginBottom: 8 }}>Game not found</p>
            {currentGameError && (
              <p style={{ color: "#e94560", fontSize: 13 }}>{currentGameError}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  const game = currentGame;
  const owned = Array.isArray(licenses) && licenses.some((l) => l.game.id === game.id && l.status === "ACTIVE");

  const handleBuy = async () => {
    if (!user) {
      navigate("/login");
      return;
    }
    setError("");
    try {
      const result = await checkout(game.id);
      if (!result.free && result.checkoutUrl) {
        // Open Stripe Checkout in system browser, then poll for license
        await window.boilerdeck.shell.openExternal(result.checkoutUrl);
        // Poll for license completion (Stripe webhook may take a few seconds)
        const poll = setInterval(async () => {
          await fetchLicenses();
          const updated = useLibraryStore.getState().licenses;
          if (updated.some((l) => l.game.id === game.id && l.status === "ACTIVE")) {
            clearInterval(poll);
          }
        }, 3000);
        // Stop polling after 5 minutes
        setTimeout(() => clearInterval(poll), 300_000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    }
  };

  const handleDownload = async () => {
    try {
      const torrent = await useLibraryStore.getState().fetchTorrent(game.id);
      const installDir = await window.boilerdeck.platform.getInstallDir();
      // WebTorrent creates the torrent root folder (game.slug) inside downloadPath,
      // so pass installDir directly — not installDir/slug — to avoid double nesting
      const downloadPath = installDir;
      const installPath = `${installDir}/${game.slug}`;

      // Fetch .torrent file for faster start (skip metadata download phase)
      // Falls back to magnet URI if fetch fails
      let torrentFileBase64: string | undefined;
      try {
        torrentFileBase64 = await fetchTorrentFileBase64(game.id);
      } catch (err) {
        console.warn("[download] Failed to fetch .torrent file, falling back to magnet URI:", err);
      }

      await useDownloadStore.getState().startDownload({
        magnetUri: torrent.magnetUri,
        torrentFileBase64,
        gameId: game.id,
        title: game.title,
        downloadPath,
        developerPubkey: game.pubkey ?? undefined,
        meta: {
          gameId: game.id,
          title: game.title,
          slug: game.slug,
          exePath: game.exePath,
          version: game.latestVersion?.version ?? "unknown",
          coverImageUrl: game.coverImageUrl,
          downloadPath: installPath,
        },
      });
      navigate("/downloads");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  };

  return (
    <div>
      <button style={styles.back} onClick={() => navigate("/")}>
        &larr; Back to Store
      </button>

      <img
        style={styles.cover}
        src={resolveCoverUrl(game.coverImageUrl)}
        alt={game.title}
        onError={(e) => {
          (e.target as HTMLImageElement).src = PLACEHOLDER_COVER;
        }}
      />

      <div style={styles.title}>{game.title}</div>
      <div style={styles.studio}>{game.studioName}</div>
      <div style={styles.description}>{game.description}</div>

      <div style={styles.infoRow}>
        {game.latestVersion && (
          <>
            <span style={styles.infoBadge}>v{game.latestVersion.version}</span>
            <span style={styles.infoBadge}>
              {formatSize(game.latestVersion.fileSizeBytes)}
            </span>
          </>
        )}
      </div>

      <div style={styles.price}>{formatPrice(game.priceCents)}</div>

      {owned ? (
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={styles.ownedBadge}>Owned</span>
          <button style={styles.actionBtn} onClick={handleDownload}>
            Download
          </button>
        </div>
      ) : (
        <button
          style={styles.actionBtn}
          onClick={handleBuy}
          disabled={checkoutLoading}
        >
          {checkoutLoading
            ? "Processing..."
            : game.priceCents === 0
              ? "Get Free"
              : `Buy ${formatPrice(game.priceCents)}`}
        </button>
      )}

      {error && (
        <p style={{ color: "#e94560", fontSize: 13, marginTop: 12 }}>{error}</p>
      )}

      {/* Top Seeders */}
      <TopSeedersSection infoHash={game?.latestVersion?.infoHash} />

      {/* Review Form — only if logged in, owns game, and hasn't reviewed yet */}
      {slug && user && owned && !hasReviewed && (
        <ReviewForm
          slug={slug}
          onReviewSubmitted={() => setReviewRefreshKey((k) => k + 1)}
        />
      )}

      {/* Reviews */}
      {slug && <ReviewSection slug={slug} refreshKey={reviewRefreshKey} />}
    </div>
  );
}

interface ReputationData {
  pubkey: string;
  score: number;
  attestationCount: number;
  uniqueAttesters: number;
}

interface SeederInfo {
  pubkey: string;
  reputation: ReputationData;
}

function getBadge(score: number): { label: string; color: string; bgColor: string } | null {
  if (score >= 200) return { label: "Gold", color: "#ffd700", bgColor: "rgba(255,215,0,0.15)" };
  if (score >= 50) return { label: "Silver", color: "#c0c0c0", bgColor: "rgba(192,192,192,0.15)" };
  if (score >= 10) return { label: "Bronze", color: "#cd7f32", bgColor: "rgba(205,127,50,0.15)" };
  return null;
}

function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 16) return pubkey;
  return `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`;
}

function TopSeedersSection({ infoHash }: { infoHash?: string | null }) {
  const [seeders, setSeeders] = useState<SeederInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!infoHash) {
      setLoading(false);
      return;
    }

    apiFetch<Array<{ pubkey: string; tags: string[][] }>>(`/events?kinds=31338`)
      .then(async (events) => {
        if (!Array.isArray(events)) {
          setLoading(false);
          return;
        }

        const seederPubkeys = new Set<string>();
        for (const event of events) {
          if (!Array.isArray(event.tags)) continue;
          const dTag = event.tags.find((t) => t[0] === "d" && t[1] === infoHash);
          if (!dTag) continue;
          const pTag = event.tags.find((t) => t[0] === "p" && t[1]);
          if (pTag) seederPubkeys.add(pTag[1]);
        }

        const seederInfos: SeederInfo[] = [];
        for (const pk of seederPubkeys) {
          try {
            const rep = await apiFetch<ReputationData>(`/reputation/${pk}`);
            if (rep.score > 0) {
              seederInfos.push({ pubkey: pk, reputation: rep });
            }
          } catch {
            // Skip
          }
        }

        seederInfos.sort((a, b) => b.reputation.score - a.reputation.score);
        setSeeders(seederInfos.slice(0, 10));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [infoHash]);

  return (
    <div
      style={{
        backgroundColor: "#16213e",
        borderRadius: 8,
        border: "1px solid #0f3460",
        padding: 24,
        marginTop: 24,
        marginBottom: 24,
        maxWidth: 600,
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 16 }}>Top Seeders</h2>
      {loading ? (
        <p style={{ fontSize: 13, color: "#888" }}>Loading...</p>
      ) : seeders.length === 0 ? (
        <p style={{ fontSize: 13, color: "#888" }}>
          No seeding data yet. Seeder rankings will appear as download activity accumulates.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {seeders.map((seeder, i) => {
            const badge = getBadge(seeder.reputation.score);
            return (
              <div
                key={seeder.pubkey}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 12px",
                  borderRadius: 4,
                  backgroundColor: "#0a0a1a",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 700, color: "#888", width: 24 }}>
                  #{i + 1}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontFamily: "monospace",
                    color: "#e94560",
                    flex: 1,
                    cursor: "pointer",
                  }}
                  onClick={() => window.location.hash = `/profile/${seeder.pubkey}`}
                >
                  {truncatePubkey(seeder.pubkey)}
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>
                  {seeder.reputation.score.toFixed(1)}
                </span>
                {badge && (
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 4,
                      backgroundColor: badge.bgColor,
                      color: badge.color,
                      fontSize: 11,
                      fontWeight: 700,
                      border: `1px solid ${badge.color}`,
                    }}
                  >
                    {badge.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
