import { useEffect, useState } from "react";

const styles = {
  banner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 16px",
    backgroundColor: "#0f3460",
    borderBottom: "1px solid #e94560",
    fontSize: 13,
    color: "#e0e0e0",
  } as React.CSSProperties,
  text: {
    margin: 0,
  } as React.CSSProperties,
  button: {
    background: "#e94560",
    border: "none",
    color: "#fff",
    padding: "6px 14px",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
  } as React.CSSProperties,
};

export function UpdateBanner() {
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);

  useEffect(() => {
    window.boilerdeck.updater.onUpdateDownloaded((data) => {
      setUpdateVersion(data.version);
    });
    return () => {
      window.boilerdeck.updater.removeUpdateListener();
    };
  }, []);

  if (!updateVersion) return null;

  return (
    <div style={styles.banner}>
      <p style={styles.text}>
        A new version ({updateVersion}) has been downloaded and is ready to install.
      </p>
      <button
        style={styles.button}
        onClick={() => window.boilerdeck.updater.restartForUpdate()}
      >
        Restart to Update
      </button>
    </div>
  );
}
