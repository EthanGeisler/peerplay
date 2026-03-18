import { useEffect, useState, useCallback, useRef } from "react";
import { useAuthStore } from "../stores/authStore";

type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "up-to-date" | "error";

const styles = {
  heading: {
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 24,
    color: "#ffffff",
  } as React.CSSProperties,
  section: {
    backgroundColor: "#16213e",
    borderRadius: 8,
    padding: 20,
    border: "1px solid #0f3460",
    marginBottom: 16,
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: "#fff",
    marginBottom: 12,
  } as React.CSSProperties,
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  } as React.CSSProperties,
  label: {
    fontSize: 14,
    color: "#888",
  } as React.CSSProperties,
  value: {
    fontSize: 14,
    color: "#e0e0e0",
  } as React.CSSProperties,
  btn: {
    padding: "6px 16px",
    fontSize: 13,
    border: "1px solid #0f3460",
    borderRadius: 4,
    backgroundColor: "transparent",
    color: "#e0e0e0",
    cursor: "pointer",
  } as React.CSSProperties,
  btnPrimary: {
    padding: "6px 16px",
    fontSize: 13,
    border: "none",
    borderRadius: 4,
    backgroundColor: "#58a6ff",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
  } as React.CSSProperties,
  btnRestart: {
    padding: "6px 16px",
    fontSize: 13,
    border: "none",
    borderRadius: 4,
    backgroundColor: "#e94560",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
  } as React.CSSProperties,
  pathDisplay: {
    fontSize: 13,
    color: "#aaa",
    fontFamily: "monospace",
    padding: "6px 10px",
    backgroundColor: "#0d1b2a",
    borderRadius: 4,
    flex: 1,
    marginRight: 10,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } as React.CSSProperties,
  progressBarOuter: {
    width: "100%",
    height: 8,
    backgroundColor: "#0d1b2a",
    borderRadius: 4,
    overflow: "hidden",
    marginTop: 8,
  } as React.CSSProperties,
  progressBarInner: {
    height: "100%",
    backgroundColor: "#58a6ff",
    borderRadius: 4,
    transition: "width 0.3s ease",
  } as React.CSSProperties,
  statusText: {
    fontSize: 12,
    color: "#888",
    marginTop: 6,
  } as React.CSSProperties,
  errorText: {
    fontSize: 12,
    color: "#e94560",
    marginTop: 6,
  } as React.CSSProperties,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Settings() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const [version, setVersion] = useState("...");
  const [installDir, setInstallDir] = useState("...");

  // Update state
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [downloadTransferred, setDownloadTransferred] = useState(0);
  const [downloadTotal, setDownloadTotal] = useState(0);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const listenersAttached = useRef(false);

  useEffect(() => {
    window.boilerdeck.platform.getVersion().then(setVersion);
    window.boilerdeck.platform.getInstallDir().then(setInstallDir);
  }, []);

  // Attach updater listeners once
  useEffect(() => {
    if (listenersAttached.current) return;
    listenersAttached.current = true;

    window.boilerdeck.updater.onUpdateAvailable((data) => {
      setUpdateVersion(data.version);
      setUpdateStatus("downloading");
      setUpdateError(null);
    });

    window.boilerdeck.updater.onUpdateNotAvailable(() => {
      setUpdateStatus("up-to-date");
    });

    window.boilerdeck.updater.onUpdateProgress((data) => {
      setUpdateStatus("downloading");
      setDownloadPercent(data.percent);
      setDownloadSpeed(data.bytesPerSecond);
      setDownloadTransferred(data.transferred);
      setDownloadTotal(data.total);
    });

    window.boilerdeck.updater.onUpdateDownloaded((data) => {
      setUpdateVersion(data.version);
      setUpdateStatus("ready");
      setDownloadPercent(100);
    });

    window.boilerdeck.updater.onUpdateError((data) => {
      setUpdateStatus("error");
      setUpdateError(data.message);
    });

    return () => {
      window.boilerdeck.updater.removeUpdateListeners();
      listenersAttached.current = false;
    };
  }, []);

  const handleCheckForUpdate = useCallback(async () => {
    setUpdateStatus("checking");
    setUpdateError(null);
    setDownloadPercent(0);
    await window.boilerdeck.updater.checkForUpdate();
    // The result comes back via IPC events (onUpdateAvailable / onUpdateNotAvailable / onUpdateError)
  }, []);

  const handleChangeDir = async () => {
    const dir = await window.boilerdeck.dialog.selectDirectory();
    if (dir) {
      await window.boilerdeck.store.set("installDir", dir);
      setInstallDir(dir);
    }
  };

  const updateStatusMessage = (): string => {
    switch (updateStatus) {
      case "checking": return "Checking for updates...";
      case "available": return `Update v${updateVersion} found. Starting download...`;
      case "downloading":
        return `Downloading${updateVersion ? ` v${updateVersion}` : ""}... ${downloadPercent.toFixed(0)}% (${formatBytes(downloadTransferred)} / ${formatBytes(downloadTotal)}) — ${formatBytes(downloadSpeed)}/s`;
      case "ready": return `v${updateVersion} is ready to install.`;
      case "up-to-date": return "You're on the latest version.";
      case "error": return "";
      default: return "";
    }
  };

  return (
    <div>
      <h1 style={styles.heading}>Settings</h1>

      {/* Account */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Account</div>
        {user ? (
          <>
            <div style={styles.row}>
              <span style={styles.label}>Display Name</span>
              <span style={styles.value}>{user.displayName}</span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>Email</span>
              <span style={styles.value}>{user.email ?? "Nostr User"}</span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>Role</span>
              <span style={styles.value}>{user.role}</span>
            </div>
            <div style={{ marginTop: 12 }}>
              <button
                style={{ ...styles.btn, borderColor: "#e94560", color: "#e94560" }}
                onClick={() => logout()}
              >
                Sign Out
              </button>
            </div>
          </>
        ) : (
          <span style={styles.value}>Not signed in</span>
        )}
      </div>

      {/* Install Location */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Install Location</div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={styles.pathDisplay}>{installDir}</span>
          <button style={styles.btn} onClick={handleChangeDir}>
            Change
          </button>
        </div>
      </div>

      {/* Updates */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Updates</div>
        <div style={styles.row}>
          <span style={styles.label}>Current Version</span>
          <span style={styles.value}>{version}</span>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            style={{
              ...styles.btnPrimary,
              opacity: updateStatus === "checking" || updateStatus === "downloading" ? 0.5 : 1,
              cursor: updateStatus === "checking" || updateStatus === "downloading" ? "not-allowed" : "pointer",
            }}
            disabled={updateStatus === "checking" || updateStatus === "downloading"}
            onClick={handleCheckForUpdate}
          >
            {updateStatus === "checking" ? "Checking..." : "Check for Updates"}
          </button>

          <button
            style={{
              ...styles.btnRestart,
              opacity: updateStatus === "ready" ? 1 : 0.3,
              cursor: updateStatus === "ready" ? "pointer" : "not-allowed",
            }}
            disabled={updateStatus !== "ready"}
            onClick={() => window.boilerdeck.updater.restartForUpdate()}
          >
            Restart to Update
          </button>
        </div>

        {/* Progress bar — visible during download */}
        {updateStatus === "downloading" && (
          <div style={styles.progressBarOuter}>
            <div style={{ ...styles.progressBarInner, width: `${downloadPercent}%` }} />
          </div>
        )}

        {/* Status text */}
        {updateStatus !== "idle" && updateStatus !== "error" && (
          <div style={styles.statusText}>{updateStatusMessage()}</div>
        )}

        {/* Error text */}
        {updateStatus === "error" && updateError && (
          <div style={styles.errorText}>{updateError}</div>
        )}
      </div>

      {/* App Info */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>About</div>
        <div style={styles.row}>
          <span style={styles.label}>Platform</span>
          <span style={styles.value}>BoilerDeck Desktop Client</span>
        </div>
      </div>
    </div>
  );
}
