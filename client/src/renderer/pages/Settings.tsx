import { useEffect, useState, useCallback, useRef } from "react";
import { useAuthStore } from "../stores/authStore";

type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "up-to-date" | "error";
type PrivacyMode = "off" | "tor" | "socks5";
type TestResult = { status: "idle" } | { status: "testing" } | { status: "success"; latencyMs: number } | { status: "error"; error: string };

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
  radioGroup: {
    display: "flex",
    gap: 16,
    marginBottom: 12,
  } as React.CSSProperties,
  radioLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 14,
    color: "#e0e0e0",
    cursor: "pointer",
  } as React.CSSProperties,
  inputField: {
    padding: "6px 10px",
    fontSize: 13,
    backgroundColor: "#0d1b2a",
    border: "1px solid #0f3460",
    borderRadius: 4,
    color: "#e0e0e0",
    outline: "none",
    width: "100%",
  } as React.CSSProperties,
  inputRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  } as React.CSSProperties,
  inputLabel: {
    fontSize: 13,
    color: "#888",
    minWidth: 80,
    flexShrink: 0,
  } as React.CSSProperties,
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
    fontSize: 13,
    color: "#e0e0e0",
  } as React.CSSProperties,
  infoBox: {
    marginTop: 12,
    padding: "10px 14px",
    backgroundColor: "#0d1b2a",
    borderRadius: 4,
    border: "1px solid #0f3460",
    fontSize: 12,
    color: "#888",
    lineHeight: 1.5,
  } as React.CSSProperties,
  successText: {
    fontSize: 12,
    color: "#3fb950",
    marginTop: 6,
  } as React.CSSProperties,
  tooltip: {
    fontSize: 11,
    color: "#666",
    marginLeft: 4,
    fontStyle: "italic",
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

  // Identity & Keys state
  const [hasIdentity, setHasIdentity] = useState(false);
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [backedUp, setBackedUp] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importInput, setImportInput] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  // Update state
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [downloadTransferred, setDownloadTransferred] = useState(0);
  const [downloadTotal, setDownloadTotal] = useState(0);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const listenersAttached = useRef(false);

  // Privacy & Network state
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>("off");
  const [socksHost, setSocksHost] = useState("");
  const [socksPort, setSocksPort] = useState(1080);
  const [socksUsername, setSocksUsername] = useState("");
  const [socksPassword, setSocksPassword] = useState("");
  const [routeApiTraffic, setRouteApiTraffic] = useState(true);
  const [routeTorrentTraffic, setRouteTorrentTraffic] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>({ status: "idle" });
  const [torBootstrap, setTorBootstrap] = useState(0);
  const [torStatus, setTorStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [torError, setTorError] = useState<string | null>(null);
  const torListenerAttached = useRef(false);
  const privacyLoaded = useRef(false);

  useEffect(() => {
    window.boilerdeck.platform.getVersion().then(setVersion);
    window.boilerdeck.platform.getInstallDir().then(setInstallDir);
    window.boilerdeck.crypto.hasKey().then((has) => {
      setHasIdentity(has);
      if (has) {
        window.boilerdeck.crypto.getPublicKey().then(setPubkey);
      }
    });
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

  // Load privacy settings on mount
  useEffect(() => {
    if (privacyLoaded.current) return;
    privacyLoaded.current = true;

    window.boilerdeck.privacy.getSettings().then((s) => {
      setPrivacyMode(s.mode);
      setSocksHost(s.socksHost);
      setSocksPort(s.socksPort);
      setSocksUsername(s.socksUsername ?? "");
      setSocksPassword(s.socksPassword ?? "");
      setRouteApiTraffic(s.routeApiTraffic);
      setRouteTorrentTraffic(s.routeTorrentTraffic);

      // If Tor mode was saved, check current Tor status
      if (s.mode === "tor") {
        window.boilerdeck.tor.status().then((st) => {
          if (st.running) {
            setTorStatus("connected");
            setTorBootstrap(st.bootstrapProgress);
          }
        });
      }
    });
  }, []);

  // Tor bootstrap progress listener
  useEffect(() => {
    if (torListenerAttached.current) return;
    torListenerAttached.current = true;

    window.boilerdeck.tor.onBootstrapProgress((data) => {
      setTorBootstrap(data.progress);
      if (data.progress >= 100) {
        setTorStatus("connected");
      } else {
        setTorStatus("connecting");
      }
    });

    return () => {
      window.boilerdeck.tor.removeBootstrapListener();
      torListenerAttached.current = false;
    };
  }, []);

  // Save privacy settings helper
  const savePrivacySettings = useCallback(async (overrides: Partial<{
    mode: PrivacyMode;
    socksHost: string;
    socksPort: number;
    socksUsername: string;
    socksPassword: string;
    routeApiTraffic: boolean;
    routeTorrentTraffic: boolean;
  }> = {}) => {
    const settings = {
      mode: overrides.mode ?? privacyMode,
      socksHost: overrides.socksHost ?? socksHost,
      socksPort: overrides.socksPort ?? socksPort,
      socksUsername: (overrides.socksUsername ?? socksUsername) || undefined,
      socksPassword: (overrides.socksPassword ?? socksPassword) || undefined,
      routeApiTraffic: overrides.routeApiTraffic ?? routeApiTraffic,
      routeTorrentTraffic: overrides.routeTorrentTraffic ?? routeTorrentTraffic,
    };
    await window.boilerdeck.privacy.saveSettings(settings);
  }, [privacyMode, socksHost, socksPort, socksUsername, socksPassword, routeApiTraffic, routeTorrentTraffic]);

  // Mode change handler — start/stop Tor as needed
  const handleModeChange = useCallback(async (newMode: PrivacyMode) => {
    const oldMode = privacyMode;
    setPrivacyMode(newMode);
    setTestResult({ status: "idle" });

    // When switching away from Tor, stop it
    if (oldMode === "tor" && newMode !== "tor") {
      setTorStatus("idle");
      setTorBootstrap(0);
      setTorError(null);
      window.boilerdeck.tor.stop().catch(() => {});
    }

    // When switching to Tor, auto-start it
    if (newMode === "tor") {
      setTorStatus("connecting");
      setTorBootstrap(0);
      setTorError(null);
      // Disable torrent routing in Tor mode
      setRouteTorrentTraffic(false);
      try {
        const result = await window.boilerdeck.tor.start();
        if (result.error) {
          setTorStatus("error");
          setTorError(result.error);
        } else if (result.running && result.bootstrapProgress >= 100) {
          setTorStatus("connected");
          setTorBootstrap(100);
        }
      } catch (err: unknown) {
        setTorStatus("error");
        setTorError(err instanceof Error ? err.message : "Failed to start Tor");
      }
      await savePrivacySettings({ mode: newMode, routeTorrentTraffic: false });
    } else {
      await savePrivacySettings({ mode: newMode });
    }
  }, [privacyMode, savePrivacySettings]);

  // Test connection handler
  const handleTestConnection = useCallback(async () => {
    setTestResult({ status: "testing" });
    const start = Date.now();
    try {
      const result = await window.boilerdeck.privacy.testConnection();
      const latency = Date.now() - start;
      if (result.success) {
        setTestResult({ status: "success", latencyMs: latency });
      } else {
        setTestResult({ status: "error", error: result.error ?? "Connection failed" });
      }
    } catch (err: unknown) {
      setTestResult({ status: "error", error: err instanceof Error ? err.message : "Connection test failed" });
    }
  }, []);

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

      {/* Identity & Keys */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Identity &amp; Keys</div>

        {!hasIdentity && !showMnemonic && (
          <>
            <p style={{ ...styles.value, marginBottom: 12 }}>
              Generate a cryptographic identity to sign your activity on the network. This is independent of your account.
            </p>
            <button
              style={styles.btnPrimary}
              onClick={async () => {
                const result = await window.boilerdeck.crypto.generateKeypair();
                setMnemonic(result.mnemonic);
                setPubkey(result.pubkeyHex);
                setShowMnemonic(true);
                setBackedUp(false);
              }}
            >
              Generate Identity
            </button>
          </>
        )}

        {showMnemonic && mnemonic && (
          <>
            <p style={{ ...styles.label, marginBottom: 8 }}>
              Write down your recovery phrase and store it somewhere safe:
            </p>
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 8,
              marginBottom: 16,
              padding: 16,
              backgroundColor: "#0d1b2a",
              borderRadius: 4,
              border: "1px solid #0f3460",
            }}>
              {mnemonic.split(" ").map((word, i) => (
                <div key={i} style={{
                  fontFamily: "monospace",
                  fontSize: 14,
                  color: "#e0e0e0",
                  padding: "4px 8px",
                }}>
                  <span style={{ color: "#888", marginRight: 6 }}>{i + 1}.</span>
                  {word}
                </div>
              ))}
            </div>
            <label style={{ ...styles.checkboxRow, marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={backedUp}
                onChange={(e) => setBackedUp(e.target.checked)}
              />
              I have written down my recovery phrase
            </label>
            <button
              style={{
                ...styles.btnPrimary,
                opacity: backedUp ? 1 : 0.4,
                cursor: backedUp ? "pointer" : "not-allowed",
              }}
              disabled={!backedUp}
              onClick={() => {
                setShowMnemonic(false);
                setMnemonic(null);
                setHasIdentity(true);
              }}
            >
              Continue
            </button>
          </>
        )}

        {hasIdentity && !showMnemonic && pubkey && (
          <>
            <div style={styles.row}>
              <span style={styles.label}>Public Key</span>
              <span style={{ ...styles.value, fontFamily: "monospace" }}>
                {pubkey.slice(0, 8)}...{pubkey.slice(-8)}
              </span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>Status</span>
              <span style={{ fontSize: 14, color: "#3fb950", fontWeight: 600 }}>Active</span>
            </div>

            {!showImport && (
              <div style={{ marginTop: 12 }}>
                <button
                  style={styles.btn}
                  onClick={() => { setShowImport(true); setImportError(null); setImportInput(""); }}
                >
                  Import Recovery Phrase
                </button>
              </div>
            )}

            {showImport && (
              <div style={{ marginTop: 12 }}>
                <div style={styles.inputRow}>
                  <input
                    type="text"
                    style={styles.inputField}
                    value={importInput}
                    placeholder="Enter 12-word recovery phrase"
                    onChange={(e) => { setImportInput(e.target.value); setImportError(null); }}
                  />
                  <button
                    style={styles.btnPrimary}
                    onClick={async () => {
                      const words = importInput.trim().split(/\s+/);
                      if (words.length !== 12) {
                        setImportError("Recovery phrase must be exactly 12 words.");
                        return;
                      }
                      try {
                        const result = await window.boilerdeck.crypto.importMnemonic(importInput.trim());
                        setPubkey(result.pubkeyHex);
                        setShowImport(false);
                        setImportInput("");
                        setImportError(null);
                      } catch (err: unknown) {
                        setImportError(err instanceof Error ? err.message : "Import failed");
                      }
                    }}
                  >
                    Import
                  </button>
                  <button
                    style={styles.btn}
                    onClick={() => { setShowImport(false); setImportError(null); }}
                  >
                    Cancel
                  </button>
                </div>
                {importError && <div style={styles.errorText}>{importError}</div>}
              </div>
            )}

            <div style={styles.infoBox}>
              Your recovery phrase was shown when you generated your identity. It cannot be retrieved from this device.
            </div>
          </>
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

      {/* Privacy & Network */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Privacy &amp; Network</div>

        {/* Mode selector */}
        <div style={{ marginBottom: 4 }}>
          <span style={{ ...styles.label, marginBottom: 8, display: "block" }}>Proxy Mode</span>
          <div style={styles.radioGroup}>
            <label style={styles.radioLabel}>
              <input
                type="radio"
                name="privacyMode"
                checked={privacyMode === "off"}
                onChange={() => handleModeChange("off")}
              />
              Off
            </label>
            <label style={styles.radioLabel}>
              <input
                type="radio"
                name="privacyMode"
                checked={privacyMode === "tor"}
                onChange={() => handleModeChange("tor")}
              />
              Tor (built-in)
            </label>
            <label style={styles.radioLabel}>
              <input
                type="radio"
                name="privacyMode"
                checked={privacyMode === "socks5"}
                onChange={() => handleModeChange("socks5")}
              />
              Custom SOCKS5
            </label>
          </div>
        </div>

        {/* Tor status display */}
        {privacyMode === "tor" && (
          <div style={{ marginBottom: 12 }}>
            <div style={styles.progressBarOuter}>
              <div style={{
                ...styles.progressBarInner,
                width: `${torBootstrap}%`,
                backgroundColor: torStatus === "error" ? "#e94560" : torStatus === "connected" ? "#3fb950" : "#58a6ff",
              }} />
            </div>
            <div style={{
              fontSize: 12,
              marginTop: 6,
              color: torStatus === "error" ? "#e94560" : torStatus === "connected" ? "#3fb950" : "#888",
            }}>
              {torStatus === "connecting" && `Connecting... ${torBootstrap}%`}
              {torStatus === "connected" && "Connected"}
              {torStatus === "error" && `Error: ${torError ?? "Unknown error"}`}
              {torStatus === "idle" && "Not started"}
            </div>
          </div>
        )}

        {/* SOCKS5 fields — only when Custom SOCKS5 selected */}
        {privacyMode === "socks5" && (
          <div style={{ marginBottom: 12 }}>
            <div style={styles.inputRow}>
              <span style={styles.inputLabel}>Host</span>
              <input
                type="text"
                style={styles.inputField}
                value={socksHost}
                placeholder="proxy-nl.privateinternetaccess.com"
                onChange={(e) => { setSocksHost(e.target.value); }}
                onBlur={() => savePrivacySettings({ socksHost })}
              />
            </div>
            <div style={styles.inputRow}>
              <span style={styles.inputLabel}>Port</span>
              <input
                type="number"
                style={{ ...styles.inputField, width: 100 }}
                value={socksPort}
                placeholder="1080"
                onChange={(e) => { setSocksPort(parseInt(e.target.value, 10) || 0); }}
                onBlur={() => savePrivacySettings({ socksPort })}
              />
            </div>
            <div style={styles.inputRow}>
              <span style={styles.inputLabel}>Username</span>
              <input
                type="text"
                style={styles.inputField}
                value={socksUsername}
                placeholder="Optional"
                onChange={(e) => { setSocksUsername(e.target.value); }}
                onBlur={() => savePrivacySettings({ socksUsername })}
              />
            </div>
            <div style={styles.inputRow}>
              <span style={styles.inputLabel}>Password</span>
              <input
                type="password"
                style={styles.inputField}
                value={socksPassword}
                placeholder="Optional"
                onChange={(e) => { setSocksPassword(e.target.value); }}
                onBlur={() => savePrivacySettings({ socksPassword })}
              />
            </div>
          </div>
        )}

        {/* Traffic routing checkboxes — only when proxy active */}
        {privacyMode !== "off" && (
          <div style={{ marginBottom: 12 }}>
            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={routeApiTraffic}
                onChange={(e) => {
                  setRouteApiTraffic(e.target.checked);
                  savePrivacySettings({ routeApiTraffic: e.target.checked });
                }}
              />
              Route API traffic through proxy
            </label>
            <label style={{
              ...styles.checkboxRow,
              opacity: privacyMode === "tor" ? 0.4 : 1,
              cursor: privacyMode === "tor" ? "not-allowed" : "pointer",
            }}>
              <input
                type="checkbox"
                checked={routeTorrentTraffic}
                disabled={privacyMode === "tor"}
                onChange={(e) => {
                  setRouteTorrentTraffic(e.target.checked);
                  savePrivacySettings({ routeTorrentTraffic: e.target.checked });
                }}
              />
              Route game downloads through proxy
              {privacyMode === "tor" && (
                <span style={styles.tooltip}>
                  Tor is too slow for game downloads — use a SOCKS5 proxy from your VPN provider instead
                </span>
              )}
            </label>
          </div>
        )}

        {/* Test Connection button */}
        {privacyMode !== "off" && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <button
              style={{
                ...styles.btnPrimary,
                opacity: testResult.status === "testing" ? 0.5 : 1,
                cursor: testResult.status === "testing" ? "not-allowed" : "pointer",
              }}
              disabled={testResult.status === "testing"}
              onClick={handleTestConnection}
            >
              {testResult.status === "testing" ? "Testing..." : "Test Connection"}
            </button>
            {testResult.status === "success" && (
              <span style={styles.successText}>
                Connected ({testResult.latencyMs}ms)
              </span>
            )}
            {testResult.status === "error" && (
              <span style={styles.errorText}>
                {testResult.error}
              </span>
            )}
          </div>
        )}

        {/* Info box */}
        <div style={styles.infoBox}>
          Tor hides your identity from the BoilerDeck server. For private game downloads at full speed,
          use a VPN provider's SOCKS5 proxy (PIA, Mullvad, NordVPN, etc.).
        </div>
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
