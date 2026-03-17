import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useGameStore } from "../stores/gameStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useAuthStore } from "../stores/authStore";
import { formatPrice, formatSize, PLACEHOLDER_COVER } from "../utils";
import type { ApiTorrent } from "../types";

export function GameDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { currentGame: game, loading, fetchGameBySlug } = useGameStore();
  const user = useAuthStore((s) => s.user);
  const licenses = useLibraryStore((s) => s.licenses);
  const checkout = useLibraryStore((s) => s.checkout);
  const checkoutLoading = useLibraryStore((s) => s.checkoutLoading);
  const fetchLicenses = useLibraryStore((s) => s.fetchLicenses);
  const fetchTorrent = useLibraryStore((s) => s.fetchTorrent);

  const [torrent, setTorrent] = useState<ApiTorrent | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const owned = game
    ? licenses.some((l) => l.game.id === game.id && l.status === "ACTIVE")
    : false;

  useEffect(() => {
    if (slug) fetchGameBySlug(slug);
  }, [slug, fetchGameBySlug]);

  useEffect(() => {
    if (user) fetchLicenses();
  }, [user, fetchLicenses]);

  // Fetch torrent when game is owned
  useEffect(() => {
    if (owned && game) {
      fetchTorrent(game.id).then(setTorrent).catch(() => {});
    }
  }, [owned, game, fetchTorrent]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0", color: "var(--text-secondary)" }}>
        Loading...
      </div>
    );
  }

  if (!game) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0" }}>
        <h2 style={{ fontSize: 24, marginBottom: 12 }}>Game not found</h2>
        <button
          onClick={() => navigate("/")}
          style={{
            padding: "8px 20px",
            borderRadius: "var(--radius)",
            backgroundColor: "var(--accent)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Back to Store
        </button>
      </div>
    );
  }

  const displayPrice = game.priceCents;
  const devShare = displayPrice - Math.ceil(displayPrice / 100);

  const handlePurchase = async () => {
    if (!user) {
      navigate("/login");
      return;
    }
    setPurchaseError(null);
    try {
      await checkout(game.id);
    } catch (err) {
      setPurchaseError((err as Error).message);
    }
  };

  return (
    <div>
      <button
        onClick={() => navigate("/")}
        style={{
          padding: "6px 14px",
          borderRadius: "var(--radius)",
          backgroundColor: "var(--bg-tertiary)",
          color: "var(--text-secondary)",
          fontSize: 13,
          marginBottom: 24,
        }}
      >
        &larr; Back to Store
      </button>

      {/* Hero */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gap: 24,
          marginBottom: 32,
        }}
      >
        <div>
          <img
            src={game.coverImageUrl || PLACEHOLDER_COVER}
            alt={game.title}
            style={{
              width: "100%",
              height: 320,
              objectFit: "cover",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border)",
            }}
          />
          {game.screenshots.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, overflowX: "auto" }}>
              {game.screenshots.map((ss, i) => (
                <img
                  key={ss}
                  src={ss}
                  alt={`Screenshot ${i + 1}`}
                  style={{
                    width: 200,
                    height: 112,
                    objectFit: "cover",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--border)",
                    flexShrink: 0,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border)",
            padding: 24,
            alignSelf: "start",
          }}
        >
          <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>{game.title}</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
            by {game.studioName}
          </p>

          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              marginBottom: 16,
              color: displayPrice === 0 ? "var(--accent-green)" : "var(--text-primary)",
            }}
          >
            {formatPrice(displayPrice)}
          </div>

          {owned ? (
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  padding: "12px 0",
                  textAlign: "center",
                  borderRadius: "var(--radius)",
                  backgroundColor: "rgba(63,185,80,0.15)",
                  color: "var(--accent-green)",
                  fontWeight: 700,
                  fontSize: 14,
                  marginBottom: 8,
                }}
              >
                In Your Library
              </div>
              {torrent && (
                <>
                  <a
                    href={torrent.magnetUri}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "12px 0",
                      borderRadius: "var(--radius)",
                      backgroundColor: "var(--accent-blue)",
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: 14,
                      textAlign: "center",
                      textDecoration: "none",
                      marginBottom: 8,
                      boxSizing: "border-box",
                    }}
                  >
                    Download via Torrent ({formatSize(torrent.fileSizeBytes)})
                  </a>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      backgroundColor: "var(--bg-primary)",
                      padding: 8,
                      borderRadius: "var(--radius)",
                      wordBreak: "break-all",
                      fontFamily: "monospace",
                    }}
                  >
                    {torrent.magnetUri}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              {purchaseError && (
                <div
                  style={{
                    padding: "8px 12px",
                    borderRadius: "var(--radius)",
                    backgroundColor: "rgba(233,69,96,0.15)",
                    color: "#e94560",
                    fontSize: 12,
                    marginBottom: 8,
                  }}
                >
                  {purchaseError}
                </div>
              )}
              <button
                onClick={handlePurchase}
                disabled={checkoutLoading}
                style={{
                  width: "100%",
                  padding: "12px 0",
                  borderRadius: "var(--radius)",
                  backgroundColor: checkoutLoading ? "var(--bg-tertiary)" : "var(--accent)",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 14,
                  opacity: checkoutLoading ? 0.7 : 1,
                  transition: "background-color 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!checkoutLoading) e.currentTarget.style.backgroundColor = "var(--accent-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!checkoutLoading) e.currentTarget.style.backgroundColor = "var(--accent)";
                }}
              >
                {checkoutLoading
                  ? "Processing..."
                  : !user
                    ? "Sign In to Purchase"
                    : displayPrice === 0
                      ? "Get for Free"
                      : `Buy Now \u2014 ${formatPrice(displayPrice)}`}
              </button>
            </div>
          )}

          {/* Revenue breakdown */}
          {displayPrice > 0 && (
            <div
              style={{
                backgroundColor: "var(--bg-tertiary)",
                borderRadius: "var(--radius)",
                padding: 12,
                marginBottom: 16,
                fontSize: 12,
              }}
            >
              <div style={{ color: "var(--text-muted)", marginBottom: 8, fontWeight: 600 }}>
                Revenue Split
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ color: "var(--accent-green)" }}>Developer (99%)</span>
                <span style={{ color: "var(--accent-green)" }}>${(devShare / 100).toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Platform (1%)</span>
                <span style={{ color: "var(--text-muted)" }}>
                  ${(Math.ceil(displayPrice / 100) / 100).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Version info */}
          {game.latestVersion && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 2 }}>
              <div>
                Version: <span style={{ color: "var(--text-secondary)" }}>v{game.latestVersion.version}</span>
              </div>
              <div>
                Size: <span style={{ color: "var(--text-secondary)" }}>{formatSize(game.latestVersion.fileSizeBytes)}</span>
              </div>
              <div>
                Distribution: <span style={{ color: "var(--text-secondary)" }}>BitTorrent (P2P)</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      <div
        style={{
          backgroundColor: "var(--bg-secondary)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
          padding: 24,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>About This Game</h2>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.8 }}>
          {game.description}
        </p>
      </div>
    </div>
  );
}
