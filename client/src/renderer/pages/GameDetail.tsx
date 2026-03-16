import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useGameStore } from "../stores/gameStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useDownloadStore } from "../stores/downloadStore";
import { useAuthStore } from "../stores/authStore";
import { fetchTorrentFileBase64 } from "../api";
import { formatPrice, formatSize, PLACEHOLDER_COVER } from "../utils";

const DRM_LABELS: Record<string, string> = {
  NONE: "DRM-Free",
  LIGHT: "Light DRM",
  ENCRYPTED: "Encrypted DRM",
};

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
  const fetchGameBySlug = useGameStore((s) => s.fetchGameBySlug);
  const clearCurrentGame = useGameStore((s) => s.clearCurrentGame);

  const licenses = useLibraryStore((s) => s.licenses);
  const checkoutLoading = useLibraryStore((s) => s.checkoutLoading);
  const checkout = useLibraryStore((s) => s.checkout);
  const fetchLicenses = useLibraryStore((s) => s.fetchLicenses);

  const user = useAuthStore((s) => s.user);

  const [error, setError] = useState("");

  useEffect(() => {
    if (slug) fetchGameBySlug(slug);
    return () => clearCurrentGame();
  }, [slug, fetchGameBySlug, clearCurrentGame]);

  useEffect(() => {
    if (user) fetchLicenses();
  }, [user, fetchLicenses]);

  if (currentGameLoading || !currentGame) {
    return <p style={styles.loading}>{currentGameLoading ? "Loading..." : "Game not found"}</p>;
  }

  const game = currentGame;
  const owned = licenses.some((l) => l.game.id === game.id && l.status === "ACTIVE");

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
      const downloadPath = `${installDir}/${game.slug}`;

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
        meta: {
          gameId: game.id,
          title: game.title,
          slug: game.slug,
          exePath: game.exePath,
          drmTier: game.drmTier,
          version: game.latestVersion?.version ?? "unknown",
          coverImageUrl: game.coverImageUrl,
          downloadPath,
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
        src={game.coverImageUrl || PLACEHOLDER_COVER}
        alt={game.title}
        onError={(e) => {
          (e.target as HTMLImageElement).src = PLACEHOLDER_COVER;
        }}
      />

      <div style={styles.title}>{game.title}</div>
      <div style={styles.studio}>{game.studioName}</div>
      <div style={styles.description}>{game.description}</div>

      <div style={styles.infoRow}>
        <span style={styles.infoBadge}>{DRM_LABELS[game.drmTier] ?? game.drmTier}</span>
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
    </div>
  );
}
