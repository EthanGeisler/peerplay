import { useEffect, useRef, useCallback } from "react";
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
};

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

  const fetchEntries = useLockerStore((s) => s.fetchEntries);
  const uploadFile = useLockerStore((s) => s.uploadFile);
  const uploadDirectory = useLockerStore((s) => s.uploadDirectory);
  const downloadEntry = useLockerStore((s) => s.downloadEntry);
  const deleteEntry = useLockerStore((s) => s.deleteEntry);
  const setViewMode = useLockerStore((s) => s.setViewMode);
  const setSearchQuery = useLockerStore((s) => s.setSearchQuery);
  const setSelectedTags = useLockerStore((s) => s.setSelectedTags);
  const setSortField = useLockerStore((s) => s.setSortField);
  const setSortDir = useLockerStore((s) => s.setSortDir);
  const updateUploadProgress = useLockerStore((s) => s.updateUploadProgress);
  const updateDownloadProgress = useLockerStore((s) => s.updateDownloadProgress);
  const handleSyncUpdate = useLockerStore((s) => s.handleSyncUpdate);
  const clearError = useLockerStore((s) => s.clearError);

  const listenersAttached = useRef(false);
  const syncStarted = useRef(false);

  // Fetch entries on mount when authenticated
  useEffect(() => {
    if (user) {
      fetchEntries();
    }
  }, [user, fetchEntries]);

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

  return (
    <LockerUploadZone onFileDrop={() => uploadFile()}>
      <div>
        <h1 style={styles.heading}>Data Locker</h1>

        {error && (
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

        <LockerQuotaBar quota={quota} />

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

        {/* Tag filter chips */}
        {allTags.length > 0 && (
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
        {uploadQueue.length > 0 && (
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
        {isLoading && entries.length === 0 && (
          <p style={{ color: "#888", textAlign: "center", marginTop: 40 }}>Loading locker...</p>
        )}

        {/* Empty state */}
        {!isLoading && sorted.length === 0 && (
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
        {sorted.length > 0 && (
          viewMode === "grid" ? (
            <div style={styles.grid}>
              {sorted.map((entry) => (
                <LockerFileCard
                  key={entry.entryId}
                  entry={entry}
                  viewMode="grid"
                  downloadPercent={downloadPercentMap.get(entry.entryId)}
                  onDownload={downloadEntry}
                  onDelete={deleteEntry}
                  onOpen={handleOpen}
                  onShowInFolder={handleShowInFolder}
                  onCopyInfoHash={handleCopyInfoHash}
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
                  onDownload={downloadEntry}
                  onDelete={deleteEntry}
                  onOpen={handleOpen}
                  onShowInFolder={handleShowInFolder}
                  onCopyInfoHash={handleCopyInfoHash}
                />
              ))}
            </div>
          )
        )}
      </div>
    </LockerUploadZone>
  );
}
