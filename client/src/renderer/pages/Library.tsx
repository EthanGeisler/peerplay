import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useInstalledStore } from "../stores/installedStore";
import { useDownloadStore } from "../stores/downloadStore";
import { useGameStore } from "../stores/gameStore";
import { fetchTorrentFileBase64 } from "../api";
import { PLACEHOLDER_COVER, resolveCoverUrl } from "../utils";
import type { ApiLicense } from "../types";

const styles = {
  heading: {
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 24,
    color: "#ffffff",
  } as React.CSSProperties,
  empty: {
    color: "#888",
    fontSize: 16,
    marginTop: 40,
    textAlign: "center",
  } as React.CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: 20,
  } as React.CSSProperties,
  card: {
    backgroundColor: "#16213e",
    borderRadius: 8,
    overflow: "hidden",
    border: "1px solid #0f3460",
  } as React.CSSProperties,
  cardImg: {
    width: "100%",
    height: 140,
    objectFit: "cover",
    display: "block",
  } as React.CSSProperties,
  cardBody: {
    padding: "12px 14px",
  } as React.CSSProperties,
  cardTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: "#fff",
    marginBottom: 4,
  } as React.CSSProperties,
  cardStudio: {
    fontSize: 12,
    color: "#888",
    marginBottom: 10,
  } as React.CSSProperties,
  actionBtn: {
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    marginRight: 8,
  } as React.CSSProperties,
  launchBtn: {
    backgroundColor: "#4ade80",
    color: "#000",
  } as React.CSSProperties,
  installBtn: {
    backgroundColor: "#e94560",
    color: "#fff",
  } as React.CSSProperties,
  uninstallBtn: {
    backgroundColor: "transparent",
    color: "#888",
    border: "1px solid #333",
  } as React.CSSProperties,
  signInPrompt: {
    color: "#888",
    textAlign: "center",
    marginTop: 40,
  } as React.CSSProperties,
};

function LibraryCard({ license }: { license: ApiLicense }) {
  const navigate = useNavigate();
  const installedGames = useInstalledStore((s) => s.installedGames);
  const launch = useInstalledStore((s) => s.launch);
  const uninstall = useInstalledStore((s) => s.uninstall);
  const downloads = useDownloadStore((s) => s.downloads);
  const fetchTorrent = useLibraryStore((s) => s.fetchTorrent);

  const [error, setError] = useState("");

  const game = license.game;
  const installed = game.id in installedGames;
  const downloading = Array.from(downloads.values()).some(
    (d) => d.gameId === game.id && d.status !== "completed",
  );

  const handleInstall = async () => {
    setError("");
    try {
      // Fetch full game detail for exePath and version info
      await useGameStore.getState().fetchGameBySlug(game.slug);
      const detail = useGameStore.getState().currentGame;
      const torrent = await fetchTorrent(game.id);
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
        meta: {
          gameId: game.id,
          title: game.title,
          slug: game.slug,
          exePath: detail?.exePath ?? null,
          drmTier: game.drmTier,
          version: detail?.latestVersion?.version ?? "unknown",
          coverImageUrl: game.coverImageUrl,
          downloadPath: installPath,
        },
      });
      navigate("/downloads");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start download");
    }
  };

  const handleLaunch = async () => {
    setError("");
    const result = await launch(game.id);
    if (!result.success) {
      setError(result.error ?? "Failed to launch");
    }
  };

  const handleUninstall = async () => {
    setError("");
    const result = await uninstall(game.id);
    if (!result.success) {
      setError(result.error ?? "Failed to uninstall");
    }
  };

  return (
    <div style={styles.card}>
      <img
        style={styles.cardImg}
        src={resolveCoverUrl(game.coverImageUrl)}
        alt={game.title}
        onError={(e) => {
          (e.target as HTMLImageElement).src = PLACEHOLDER_COVER;
        }}
      />
      <div style={styles.cardBody}>
        <div style={styles.cardTitle}>{game.title}</div>
        <div style={styles.cardStudio}>{game.studioName}</div>
        <div>
          {installed ? (
            <>
              <button
                style={{ ...styles.actionBtn, ...styles.launchBtn }}
                onClick={handleLaunch}
              >
                Launch
              </button>
              <button
                style={{ ...styles.actionBtn, ...styles.uninstallBtn }}
                onClick={handleUninstall}
              >
                Uninstall
              </button>
            </>
          ) : downloading ? (
            <button
              style={{ ...styles.actionBtn, backgroundColor: "#333", color: "#888" }}
              onClick={() => navigate("/downloads")}
            >
              Downloading...
            </button>
          ) : (
            <button
              style={{ ...styles.actionBtn, ...styles.installBtn }}
              onClick={handleInstall}
            >
              Install
            </button>
          )}
        </div>
        {error && (
          <p style={{ color: "#e94560", fontSize: 12, marginTop: 8 }}>{error}</p>
        )}
      </div>
    </div>
  );
}

export function Library() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const licenses = useLibraryStore((s) => s.licenses);
  const licensesLoading = useLibraryStore((s) => s.loading);
  const fetchLicenses = useLibraryStore((s) => s.fetchLicenses);
  const loadInstalled = useInstalledStore((s) => s.loadInstalled);

  useEffect(() => {
    if (user) {
      fetchLicenses();
      loadInstalled();
    }
  }, [user, fetchLicenses, loadInstalled]);

  if (loading) return <p style={styles.empty}>Loading...</p>;

  if (!user) {
    return (
      <div style={styles.signInPrompt}>
        <p style={{ marginBottom: 12, fontSize: 16 }}>Sign in to see your library</p>
        <button
          style={{
            padding: "10px 24px",
            backgroundColor: "#e94560",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 14,
          }}
          onClick={() => navigate("/login")}
        >
          Sign In
        </button>
      </div>
    );
  }

  if (licensesLoading && (!Array.isArray(licenses) || licenses.length === 0)) {
    return <p style={styles.empty}>Loading library...</p>;
  }

  const activeLicenses = Array.isArray(licenses) ? licenses.filter((l) => l.status === "ACTIVE") : [];

  return (
    <div>
      <h1 style={styles.heading}>My Library</h1>
      {activeLicenses.length === 0 ? (
        <p style={styles.empty}>
          Your library is empty. Browse the{" "}
          <span
            style={{ color: "#e94560", cursor: "pointer" }}
            onClick={() => navigate("/")}
          >
            Store
          </span>{" "}
          to find games.
        </p>
      ) : (
        <div style={styles.grid}>
          {activeLicenses.map((license) => (
            <LibraryCard key={license.id} license={license} />
          ))}
        </div>
      )}
    </div>
  );
}
