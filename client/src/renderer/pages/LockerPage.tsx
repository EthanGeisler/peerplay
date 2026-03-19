import { useEffect, useRef, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useLockerStore } from "../stores/lockerStore";
import { getAccessToken } from "../api";
import { LockerToolbar } from "../components/locker/LockerToolbar";
import { LockerQuotaBar } from "../components/locker/LockerQuotaBar";
import { LockerFileCard } from "../components/locker/LockerFileCard";
import { LockerUploadZone } from "../components/locker/LockerUploadZone";
import type { LockerIndexEntry, SortField } from "../stores/lockerStore";

const styles = {
  heading: {
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 24,
    color: "#ffffff",
  } as React.CSSProperties,
  empty: {
    textAlign: "center",
    marginTop: 60,
    color: "#888",
  } as React.CSSProperties,
  emptyTitle: {
    fontSize: 20,
    fontWeight: 600,
    color: "#ccc",
    marginBottom: 8,
  } as React.CSSProperties,
  emptySubtext: {
    fontSize: 14,
    color: "#888",
    marginBottom: 20,
  } as React.CSSProperties,
  uploadCta: {
    padding: "10px 24px",
    fontSize: 14,
    fontWeight: 600,
    border: "none",
    borderRadius: 4,
    backgroundColor: "#e94560",
    color: "#fff",
    cursor: "pointer",
  } as React.CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 16,
  } as React.CSSProperties,
  signInPrompt: {
    color: "#888",
    textAlign: "center",
    marginTop: 40,
  } as React.CSSProperties,
  errorBanner: {
    backgroundColor: "#e9456022",
    border: "1px solid #e94560",
    borderRadius: 4,
    padding: "10px 14px",
    marginBottom: 16,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 13,
    color: "#e94560",
  } as React.CSSProperties,
  tagChips: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 12,
  } as React.CSSProperties,
  tagChip: (active: boolean) => ({
    padding: "4px 10px",
    fontSize: 12,
    borderRadius: 12,
    border: `1px solid ${active ? "#e94560" : "#0f3460"}`,
    backgroundColor: active ? "#e9456033" : "transparent",
    color: active ? "#e94560" : "#888",
    cursor: "pointer",
  }) as React.CSSProperties,
  statusBanner: {
    backgroundColor: "#d2992222",
    border: "1px solid #d29922",
    borderRadius: 4,
    padding: "8px 14px",
    marginBottom: 8,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 13,
    color: "#d29922",
  } as React.CSSProperties,
  statusBannerDismiss: {
    background: "none",
    border: "none",
    color: "#d29922",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 700,
    padding: "0 4px",
    opacity: 0.7,
  } as React.CSSProperties,
  lastSyncedText: {
    fontSize: 11,
    color: "#666",
    textAlign: "right",
    marginBottom: 8,
  } as React.CSSProperties,
};

function formatLastSynced(timestampMs: number): string {
  if (timestampMs === 0) return "never";
  const diffMs = Date.now() - timestampMs;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? "s" : ""} ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs} hour${diffHrs !== 1 ? "s" : ""} ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
}

function sortEntries(entries: LockerIndexEntry[], field: SortField, dir: "asc" | "desc"): LockerIndexEntry[] {
  const sorted = [...entries].sort((a, b) => {
    switch (field) {
      case "name":
        return a.filename.localeCompare(b.filename);
      case "size":
        return a.size - b.size;
      case "date":
        return a.createdAt - b.createdAt;
      default:
        return 0;
    }
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

export function LockerPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);

  const entries = useLockerStore((s) => s.entries);
  const uploadQueue = useLockerStore((s) => s.uploadQueue);
  const downloadQueue = useLockerStore((s) => s.downloadQueue);
  const quota = useLockerStore((s) => s.quota);
  const viewMode = useLockerStore((s) => s.viewMode);
  const searchQuery = useLockerStore((s) => s.searchQuery);
  const selectedTags = useLockerStore((s) => s.selectedTags);
  const sortField = useLockerStore((s) => s.sortField);
  const sortDir = useLockerStore((s) => s.sortDir);
  const isLoading = useLockerStore((s) => s.isLoading);
  const error = useLockerStore((s) => s.error);

  const sharedWithMe = useLockerStore((s) => s.sharedWithMe);
  const sharedWithMeLoading = useLockerStore((s) => s.sharedWithMeLoading);

  const fetchEntries = useLockerStore((s) => s.fetchEntries);
  const uploadFile = useLockerStore((s) => s.uploadFile);
  const uploadDirectory = useLockerStore((s) => s.uploadDirectory);
  const downloadEntry = useLockerStore((s) => s.downloadEntry);
  const deleteEntry = useLockerStore((s) => s.deleteEntry);
  const shareEntry = useLockerStore((s) => s.shareEntry);
  const fetchSharedWithMe = useLockerStore((s) => s.fetchSharedWithMe);
  const setViewMode = useLockerStore((s) => s.setViewMode);
  const setSearchQuery = useLockerStore((s) => s.setSearchQuery);
  const setSelectedTags = useLockerStore((s) => s.setSelectedTags);
  const setSortField = useLockerStore((s) => s.setSortField);
  const setSortDir = useLockerStore((s) => s.setSortDir);
  const updateUploadProgress = useLockerStore((s) => s.updateUploadProgress);
  const updateDownloadProgress = useLockerStore((s) => s.updateDownloadProgress);
  const handleSyncUpdate = useLockerStore((s) => s.handleSyncUpdate);
  const clearError = useLockerStore((s) => s.clearError);

  const connectionStatus = useLockerStore((s) => s.connectionStatus);
  const dismissedBanners = useLockerStore((s) => s.dismissedBanners);
  const fetchConnectionStatus = useLockerStore((s) => s.fetchConnectionStatus);
  const fetchOfflineQueue = useLockerStore((s) => s.fetchOfflineQueue);
  const retryQueue = useLockerStore((s) => s.retryQueue);
  const exportIndex = useLockerStore((s) => s.exportIndex);
  const dismissBanner = useLockerStore((s) => s.dismissBanner);

  const [activeTab, setActiveTab] = useState<"my-files" | "shared">("my-files");
  const [shareDialogEntryId, setShareDialogEntryId] = useState<string | null>(null);
  const [shareRecipient, setShareRecipient] = useState("");
  const [shareLoading, setShareLoading] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);
  const [isSelfCustody, setIsSelfCustody] = useState(false);

  const listenersAttached = useRef(false);
  const syncStarted = useRef(false);

  // Fetch entries on mount when authenticated
  useEffect(() => {
    if (user) {
      fetchEntries();
      fetchSharedWithMe();
    }
  }, [user, fetchEntries, fetchSharedWithMe]);

  // Detect self-custody mode
  useEffect(() => {
    if (user) {
      window.boilerdeck.crypto.hasKey().then((has) => {
        setIsSelfCustody(has);
      }).catch(() => {});
    }
  }, [user]);

  // Poll connection status and offline queue periodically
  useEffect(() => {
    if (!user) return;
    fetchConnectionStatus();
    fetchOfflineQueue();

    const interval = setInterval(() => {
      fetchConnectionStatus();
      fetchOfflineQueue();
    }, 30_000); // every 30 seconds

    return () => clearInterval(interval);
  }, [user, fetchConnectionStatus, fetchOfflineQueue]);

  // Start sync and attach progress listeners
  useEffect(() => {
    if (!user || listenersAttached.current) return;
    listenersAttached.current = true;

    window.boilerdeck.locker.onUploadProgress((data) => {
      updateUploadProgress(data);
    });

    window.boilerdeck.locker.onDownloadProgress((data) => {
      updateDownloadProgress(data);
    });

    window.boilerdeck.locker.onSyncUpdate((data) => {
      handleSyncUpdate(data.entries);
    });

    return () => {
      window.boilerdeck.locker.removeUploadProgressListener();
      window.boilerdeck.locker.removeDownloadProgressListener();
      window.boilerdeck.locker.removeSyncUpdateListener();
      listenersAttached.current = false;
    };
  }, [user, updateUploadProgress, updateDownloadProgress, handleSyncUpdate]);

  // Start background sync
  useEffect(() => {
    if (!user || syncStarted.current) return;
    syncStarted.current = true;
    const token = getAccessToken();
    if (token) {
      window.boilerdeck.locker.startSync(token).catch(() => {});
    }
    return () => {
      window.boilerdeck.locker.stopSync().catch(() => {});
      syncStarted.current = false;
    };
  }, [user]);

  const handleOpen = useCallback((filePath: string) => {
    window.boilerdeck.locker.openFile(filePath).catch(() => {});
  }, []);

  const handleShowInFolder = useCallback((filePath: string) => {
    window.boilerdeck.locker.showInFolder(filePath).catch(() => {});
  }, []);

  const handleCopyInfoHash = useCallback((infoHash: string) => {
    navigator.clipboard.writeText(infoHash).catch(() => {});
  }, []);

  const handleShareClick = useCallback((entryId: string) => {
    setShareDialogEntryId(entryId);
    setShareRecipient("");
    setShareSuccess(false);
  }, []);

  const handleShareConfirm = useCallback(async () => {
    if (!shareDialogEntryId || !shareRecipient) return;
    setShareLoading(true);
    try {
      await shareEntry(shareDialogEntryId, shareRecipient);
      setShareSuccess(true);
      setTimeout(() => {
        setShareDialogEntryId(null);
        setShareSuccess(false);
      }, 1500);
    } catch {
      // Error handled by store
    }
    setShareLoading(false);
  }, [shareDialogEntryId, shareRecipient, shareEntry]);

  const handleCopyMagnetShared = useCallback((magnetUri: string) => {
    navigator.clipboard.writeText(magnetUri).catch(() => {});
  }, []);

  if (authLoading) return <p style={{ color: "#888", textAlign: "center", marginTop: 40 }}>Loading...</p>;

  if (!user) {
    return (
      <div style={styles.signInPrompt as React.CSSProperties}>
        <p style={{ marginBottom: 12, fontSize: 16 }}>Sign in to access your Data Locker</p>
        <button
          style={styles.uploadCta}
          onClick={() => navigate("/login")}
        >
          Sign In
        </button>
      </div>
    );
  }

  // Collect all unique tags
  const allTags = Array.from(new Set(entries.flatMap((e) => e.tags))).sort();

  // Filter entries
  let filtered = entries;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter((e) => e.filename.toLowerCase().includes(q));
  }
  if (selectedTags.length > 0) {
    filtered = filtered.filter((e) =>
      selectedTags.every((tag) => e.tags.includes(tag)),
    );
  }

  // Sort entries
  const sorted = sortEntries(filtered, sortField, sortDir);

  // Build download percent map
  const downloadPercentMap = new Map<string, number>();
  for (const d of downloadQueue) {
    downloadPercentMap.set(d.entryId, d.percent);
  }

  const shareDialogEntry = shareDialogEntryId
    ? entries.find((e) => e.entryId === shareDialogEntryId)
    : null;

  return (
    <LockerUploadZone onFileDrop={() => uploadFile()}>
      <div>
        <h1 style={styles.heading}>Data Locker</h1>

        {/* Tab switcher */}
        <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "1px solid #0f3460" }}>
          <button
            onClick={() => setActiveTab("my-files")}
            style={{
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: activeTab === "my-files" ? 600 : 400,
              color: activeTab === "my-files" ? "#e94560" : "#888",
              backgroundColor: "transparent",
              border: "none",
              borderBottom: activeTab === "my-files" ? "2px solid #e94560" : "2px solid transparent",
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            My Files
          </button>
          <button
            onClick={() => { setActiveTab("shared"); fetchSharedWithMe(); }}
            style={{
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: activeTab === "shared" ? 600 : 400,
              color: activeTab === "shared" ? "#e94560" : "#888",
              backgroundColor: "transparent",
              border: "none",
              borderBottom: activeTab === "shared" ? "2px solid #e94560" : "2px solid transparent",
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            Shared with me{sharedWithMe.length > 0 ? ` (${sharedWithMe.length})` : ""}
          </button>
        </div>

        {/* Share dialog overlay */}
        {shareDialogEntryId && (
          <div style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 300,
          }} onClick={() => setShareDialogEntryId(null)}>
            <div
              style={{
                backgroundColor: "#16213e",
                border: "1px solid #0f3460",
                borderRadius: 8,
                padding: 24,
                width: 420,
                maxWidth: "90%",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: "#fff" }}>
                Share File
              </h3>
              {shareDialogEntry && (
                <p style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>
                  Sharing: {shareDialogEntry.filename}
                </p>
              )}
              <label style={{ fontSize: 13, color: "#ccc", display: "block", marginBottom: 6 }}>
                Recipient Public Key (64-char hex)
              </label>
              <input
                type="text"
                value={shareRecipient}
                onChange={(e) => setShareRecipient(e.target.value)}
                placeholder="Recipient's nostr pubkey (hex)"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 4,
                  border: "1px solid #0f3460",
                  backgroundColor: "#0d1b2a",
                  color: "#fff",
                  fontSize: 13,
                  marginBottom: 16,
                  boxSizing: "border-box",
                }}
              />
              {shareSuccess && (
                <p style={{ fontSize: 13, color: "#3fb950", marginBottom: 12 }}>
                  Shared successfully!
                </p>
              )}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  onClick={() => setShareDialogEntryId(null)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 4,
                    border: "1px solid #0f3460",
                    backgroundColor: "transparent",
                    color: "#888",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleShareConfirm}
                  disabled={shareLoading || shareRecipient.length !== 64}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 4,
                    border: "none",
                    backgroundColor: shareRecipient.length === 64 ? "#e94560" : "#333",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: shareRecipient.length === 64 ? "pointer" : "not-allowed",
                    opacity: shareLoading ? 0.6 : 1,
                  }}
                >
                  {shareLoading ? "Sharing..." : "Share"}
                </button>
              </div>
            </div>
          </div>
        )}

        {error && activeTab === "my-files" && (
          <div style={styles.errorBanner}>
            <span>{error}</span>
            <button
              onClick={clearError}
              style={{
                background: "none",
                border: "none",
                color: "#e94560",
                cursor: "pointer",
                fontSize: 16,
                fontWeight: 700,
                padding: "0 4px",
              }}
            >
              x
            </button>
          </div>
        )}

        {/* Status banners */}
        {activeTab === "my-files" && !connectionStatus.serverOnline && !dismissedBanners.has("offline") && (
          <div style={styles.statusBanner}>
            <span>Offline — showing cached entries</span>
            <button onClick={() => dismissBanner("offline")} style={styles.statusBannerDismiss}>x</button>
          </div>
        )}
        {activeTab === "my-files" && connectionStatus.uploadQueueCount > 0 && !dismissedBanners.has("queue") && (
          <div style={styles.statusBanner}>
            <span>
              {connectionStatus.uploadQueueCount} upload{connectionStatus.uploadQueueCount !== 1 ? "s" : ""} queued — will retry when online
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={() => retryQueue()}
                style={{
                  padding: "3px 10px",
                  fontSize: 12,
                  border: "1px solid #d29922",
                  borderRadius: 3,
                  backgroundColor: "transparent",
                  color: "#d29922",
                  cursor: "pointer",
                }}
              >
                Retry Now
              </button>
              <button onClick={() => dismissBanner("queue")} style={styles.statusBannerDismiss}>x</button>
            </div>
          </div>
        )}
        {activeTab === "my-files" && !connectionStatus.relayConnected && connectionStatus.lastSynced > 0 && !dismissedBanners.has("relay") && (
          <div style={styles.statusBanner}>
            <span>Relay disconnected — showing cached entries</span>
            <button onClick={() => dismissBanner("relay")} style={styles.statusBannerDismiss}>x</button>
          </div>
        )}
        {activeTab === "my-files" && connectionStatus.lastSynced > 0 && (
          <div style={styles.lastSyncedText as React.CSSProperties}>
            Last synced: {formatLastSynced(connectionStatus.lastSynced)}
          </div>
        )}

        {activeTab === "my-files" && <LockerQuotaBar quota={quota} />}

        {activeTab === "my-files" && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <LockerToolbar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                sortField={sortField}
                sortDir={sortDir}
                onSortFieldChange={setSortField}
                onSortDirChange={setSortDir}
                onUploadFile={() => uploadFile()}
                onUploadDirectory={() => uploadDirectory()}
                isLoading={isLoading}
              />
            </div>
            <button
              onClick={() => exportIndex()}
              title="Export locker index as JSON backup"
              style={{
                padding: "6px 12px",
                fontSize: 12,
                border: "1px solid #0f3460",
                borderRadius: 4,
                backgroundColor: "transparent",
                color: "#888",
                cursor: "pointer",
                whiteSpace: "nowrap",
                marginTop: 2,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#0f3460"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#888"; }}
            >
              Export Index
            </button>
          </div>
        )}

        {/* Tag filter chips */}
        {activeTab === "my-files" && allTags.length > 0 && (
          <div style={styles.tagChips as React.CSSProperties}>
            {allTags.map((tag) => (
              <button
                key={tag}
                style={styles.tagChip(selectedTags.includes(tag))}
                onClick={() => {
                  if (selectedTags.includes(tag)) {
                    setSelectedTags(selectedTags.filter((t) => t !== tag));
                  } else {
                    setSelectedTags([...selectedTags, tag]);
                  }
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* Upload queue */}
        {activeTab === "my-files" && uploadQueue.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            {uploadQueue.map((item) => (
              <div key={item.id} style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 14px",
                backgroundColor: "#16213e",
                borderRadius: 4,
                border: "1px solid #0f3460",
                marginBottom: 4,
              }}>
                <span style={{ fontSize: 13, color: "#e0e0e0", flex: 1 }}>
                  Uploading: {item.filename}
                </span>
                <span style={{ fontSize: 12, color: "#d29922" }}>{item.percent.toFixed(0)}%</span>
                <div style={{
                  width: 100,
                  height: 4,
                  backgroundColor: "#0d1b2a",
                  borderRadius: 2,
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${item.percent}%`,
                    backgroundColor: "#d29922",
                    borderRadius: 2,
                    transition: "width 0.3s ease",
                  }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Loading state */}
        {activeTab === "my-files" && isLoading && entries.length === 0 && (
          <p style={{ color: "#888", textAlign: "center", marginTop: 40 }}>Loading locker...</p>
        )}

        {/* Empty state */}
        {activeTab === "my-files" && !isLoading && sorted.length === 0 && (
          <div style={styles.empty as React.CSSProperties}>
            <div style={styles.emptyTitle}>
              {searchQuery || selectedTags.length > 0
                ? "No files match your search"
                : "Your Data Locker is empty"}
            </div>
            <p style={styles.emptySubtext}>
              {searchQuery || selectedTags.length > 0
                ? "Try adjusting your search or filters."
                : "Upload your first file to get started. Files are encrypted and stored on the decentralized network."}
            </p>
            {!searchQuery && selectedTags.length === 0 && (
              <button
                style={styles.uploadCta}
                onClick={() => uploadFile()}
              >
                Upload Your First File
              </button>
            )}
          </div>
        )}

        {/* File grid / list */}
        {activeTab === "my-files" && sorted.length > 0 && (
          viewMode === "grid" ? (
            <div style={styles.grid}>
              {sorted.map((entry) => (
                <LockerFileCard
                  key={entry.entryId}
                  entry={entry}
                  viewMode="grid"
                  downloadPercent={downloadPercentMap.get(entry.entryId)}
                  isSelfCustody={isSelfCustody}
                  onDownload={downloadEntry}
                  onDelete={deleteEntry}
                  onOpen={handleOpen}
                  onShowInFolder={handleShowInFolder}
                  onCopyInfoHash={handleCopyInfoHash}
                  onShare={handleShareClick}
                />
              ))}
            </div>
          ) : (
            <div>
              {sorted.map((entry) => (
                <LockerFileCard
                  key={entry.entryId}
                  entry={entry}
                  viewMode="list"
                  downloadPercent={downloadPercentMap.get(entry.entryId)}
                  isSelfCustody={isSelfCustody}
                  onDownload={downloadEntry}
                  onDelete={deleteEntry}
                  onOpen={handleOpen}
                  onShowInFolder={handleShowInFolder}
                  onCopyInfoHash={handleCopyInfoHash}
                  onShare={handleShareClick}
                />
              ))}
            </div>
          )
        )}

        {/* Shared with me tab */}
        {activeTab === "shared" && (
          <div>
            {sharedWithMeLoading && (
              <p style={{ color: "#888", textAlign: "center", marginTop: 40 }}>Loading shared files...</p>
            )}
            {!sharedWithMeLoading && sharedWithMe.length === 0 && (
              <div style={styles.empty as React.CSSProperties}>
                <div style={styles.emptyTitle}>No files shared with you</div>
                <p style={styles.emptySubtext}>
                  When someone shares a file with you, it will appear here.
                </p>
              </div>
            )}
            {!sharedWithMeLoading && sharedWithMe.length > 0 && (
              <div>
                {sharedWithMe.map(({ entry, senderPubkey }) => (
                  <div
                    key={entry.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 14px",
                      backgroundColor: "#16213e",
                      borderRadius: 4,
                      border: "1px solid #0f3460",
                      marginBottom: 4,
                    }}
                  >
                    <span style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#555",
                      fontFamily: "monospace",
                      minWidth: 40,
                      textAlign: "center",
                    }}>
                      {entry.mimeType.startsWith("image/") ? "[IMG]" :
                       entry.mimeType.startsWith("video/") ? "[VID]" :
                       entry.mimeType.startsWith("audio/") ? "[AUD]" : "[FILE]"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#fff",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {entry.filename}
                      </div>
                      <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                        From: {senderPubkey.slice(0, 8)}...{senderPubkey.slice(-8)}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, color: "#888", minWidth: 70, textAlign: "right" }}>
                      {entry.size >= 1_000_000_000 ? `${(entry.size / 1_000_000_000).toFixed(1)} GB` :
                       entry.size >= 1_000_000 ? `${(entry.size / 1_000_000).toFixed(1)} MB` :
                       entry.size >= 1_000 ? `${(entry.size / 1_000).toFixed(1)} KB` :
                       `${entry.size} B`}
                    </span>
                    <span style={{ fontSize: 12, color: "#888", minWidth: 90, textAlign: "right" }}>
                      {new Date(entry.createdAt * 1000).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <button
                      onClick={() => handleCopyMagnetShared(entry.magnetUri)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 4,
                        border: "1px solid #0f3460",
                        backgroundColor: "transparent",
                        color: "#888",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#0f3460"; e.currentTarget.style.color = "#fff"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#888"; }}
                    >
                      Copy Magnet
                    </button>
                    <button
                      onClick={() => downloadEntry(entry.id)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 4,
                        border: "none",
                        backgroundColor: "#e94560",
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Download
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </LockerUploadZone>
  );
}
