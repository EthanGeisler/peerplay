import { useEffect, useState } from "react";
import { useAuthStore } from "../stores/authStore";

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
};

export function Settings() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const [version, setVersion] = useState("...");
  const [installDir, setInstallDir] = useState("...");

  useEffect(() => {
    window.boilerdeck.platform.getVersion().then(setVersion);
    window.boilerdeck.platform.getInstallDir().then(setInstallDir);
  }, []);

  const handleChangeDir = async () => {
    const dir = await window.boilerdeck.dialog.selectDirectory();
    if (dir) {
      await window.boilerdeck.store.set("installDir", dir);
      setInstallDir(dir);
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
              <span style={styles.value}>{user.email}</span>
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

      {/* App Info */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>About</div>
        <div style={styles.row}>
          <span style={styles.label}>Version</span>
          <span style={styles.value}>{version}</span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>Platform</span>
          <span style={styles.value}>BoilerDeck Desktop Client</span>
        </div>
      </div>
    </div>
  );
}
