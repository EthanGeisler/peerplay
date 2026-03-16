import { useEffect } from "react";
import { useDownloadStore } from "../stores/downloadStore";
import { formatSize } from "../utils";
import type { DownloadProgress } from "../types";

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
  card: {
    backgroundColor: "#16213e",
    borderRadius: 8,
    padding: 16,
    border: "1px solid #0f3460",
    marginBottom: 12,
  } as React.CSSProperties,
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  } as React.CSSProperties,
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: "#fff",
  } as React.CSSProperties,
  status: (status: string) =>
    ({
      fontSize: 12,
      fontWeight: 600,
      padding: "2px 10px",
      borderRadius: 3,
      color: "#000",
      backgroundColor:
        status === "completed"
          ? "#4ade80"
          : status === "paused"
            ? "#facc15"
            : status === "error"
              ? "#f87171"
              : "#60a5fa",
    }) as React.CSSProperties,
  progressBar: {
    width: "100%",
    height: 6,
    backgroundColor: "#0f3460",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 8,
  } as React.CSSProperties,
  progressFill: (pct: number) =>
    ({
      width: `${(pct * 100).toFixed(1)}%`,
      height: "100%",
      backgroundColor: "#e94560",
      borderRadius: 3,
      transition: "width 0.5s ease",
    }) as React.CSSProperties,
  stats: {
    display: "flex",
    gap: 20,
    fontSize: 12,
    color: "#888",
    marginBottom: 8,
  } as React.CSSProperties,
  controls: {
    display: "flex",
    gap: 8,
  } as React.CSSProperties,
  btn: {
    padding: "4px 12px",
    fontSize: 12,
    border: "1px solid #0f3460",
    borderRadius: 4,
    backgroundColor: "transparent",
    color: "#e0e0e0",
    cursor: "pointer",
  } as React.CSSProperties,
};

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1_000_000) return `${(bytesPerSec / 1_000_000).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1_000) return `${(bytesPerSec / 1_000).toFixed(0)} KB/s`;
  return `${bytesPerSec} B/s`;
}

function DownloadCard({ dl }: { dl: DownloadProgress }) {
  const pauseDownload = useDownloadStore((s) => s.pauseDownload);
  const resumeDownload = useDownloadStore((s) => s.resumeDownload);
  const cancelDownload = useDownloadStore((s) => s.cancelDownload);

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <span style={styles.title}>{dl.title}</span>
        <span style={styles.status(dl.status)}>{dl.status}</span>
      </div>

      <div style={styles.progressBar}>
        <div style={styles.progressFill(dl.progress)} />
      </div>

      <div style={styles.stats}>
        <span>{(dl.progress * 100).toFixed(1)}%</span>
        <span>
          {formatSize(dl.downloaded)} / {dl.total > 0 ? formatSize(dl.total) : "?"}
        </span>
        {dl.status === "downloading" && (
          <>
            <span>{formatSpeed(dl.downloadSpeed)}</span>
            <span>{dl.numPeers} peers</span>
          </>
        )}
      </div>

      <div style={styles.controls}>
        {dl.status === "downloading" && (
          <button style={styles.btn} onClick={() => pauseDownload(dl.infoHash)}>
            Pause
          </button>
        )}
        {dl.status === "paused" && (
          <button style={styles.btn} onClick={() => resumeDownload(dl.infoHash)}>
            Resume
          </button>
        )}
        {dl.status !== "completed" && (
          <button
            style={{ ...styles.btn, borderColor: "#e94560", color: "#e94560" }}
            onClick={() => cancelDownload(dl.infoHash)}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export function Downloads() {
  const downloads = useDownloadStore((s) => s.downloads);
  const initListeners = useDownloadStore((s) => s.initListeners);
  const cleanupListeners = useDownloadStore((s) => s.cleanupListeners);

  useEffect(() => {
    initListeners();
    return () => cleanupListeners();
  }, [initListeners, cleanupListeners]);

  const downloadList = Array.from(downloads.values());

  return (
    <div>
      <h1 style={styles.heading}>Downloads</h1>
      {downloadList.length === 0 ? (
        <p style={styles.empty}>No active downloads.</p>
      ) : (
        downloadList.map((dl) => <DownloadCard key={dl.infoHash} dl={dl} />)
      )}
    </div>
  );
}
