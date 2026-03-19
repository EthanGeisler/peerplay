import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import {
  useLockerStore,
  type LockerEntry,
  type LockerQuota,
  type ViewMode,
  type SortField,
  type SharedEntry,
} from "../stores/lockerStore";

// ─── Helpers ─────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getMimeIcon(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "IMG";
  if (mimeType.startsWith("video/")) return "VID";
  if (mimeType.startsWith("audio/")) return "AUD";
  if (mimeType.startsWith("text/")) return "TXT";
  if (mimeType === "application/pdf") return "PDF";
  if (
    mimeType === "application/zip" ||
    mimeType === "application/x-rar-compressed" ||
    mimeType === "application/gzip" ||
    mimeType === "application/x-7z-compressed"
  )
    return "ZIP";
  if (
    mimeType === "application/x-msdownload" ||
    mimeType === "application/x-executable"
  )
    return "EXE";
  return "FILE";
}

function getMimeColor(icon: string): string {
  switch (icon) {
    case "IMG":
      return "var(--accent-green)";
    case "VID":
      return "#e94560";
    case "AUD":
      return "#d29922";
    case "TXT":
      return "#58a6ff";
    case "PDF":
      return "#e94560";
    case "ZIP":
      return "#d29922";
    case "EXE":
      return "var(--accent-green)";
    default:
      return "var(--text-muted)";
  }
}

// ─── Encryption Badge ─────────────────────────────────────────────

function EncryptionBadge() {
  return (
    <span
      title="Your metadata is encrypted but the server manages your key. For stronger privacy, use the BoilerDeck Desktop app with self-custody keys."
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        color: "#d29922",
        padding: "2px 8px",
        backgroundColor: "rgba(210, 153, 34, 0.1)",
        borderRadius: 4,
        cursor: "help",
        whiteSpace: "nowrap",
      }}
    >
      [E] Server-managed encryption
    </span>
  );
}

// ─── Quota Bar ───────────────────────────────────────────────────

function QuotaBar({ quota }: { quota: LockerQuota }) {
  const pct = quota.max > 0 ? Math.min((quota.used / quota.max) * 100, 100) : 0;
  const color =
    pct > 90 ? "#e94560" : pct > 70 ? "#d29922" : "var(--accent-green)";

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 13,
          color: "var(--text-secondary)",
          marginBottom: 6,
        }}
      >
        <span>Storage</span>
        <span>
          {formatBytes(quota.used)} / {formatBytes(quota.max)} used
        </span>
      </div>
      <div
        style={{
          height: 8,
          backgroundColor: "var(--bg-tertiary)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            backgroundColor: color,
            borderRadius: 4,
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  );
}

// ─── File Row (list view) ────────────────────────────────────────

function FileRow({
  entry,
  onCopyMagnet,
  onShare,
}: {
  entry: LockerEntry;
  onCopyMagnet: (uri: string) => void;
  onShare?: (entryId: string) => void;
}) {
  const icon = getMimeIcon(entry.mimeType);
  const iconColor = getMimeColor(icon);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        backgroundColor: "var(--bg-card)",
        borderRadius: "var(--radius)",
        border: "1px solid var(--border)",
        padding: "10px 16px",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.borderColor = "var(--accent)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.borderColor = "var(--border)")
      }
    >
      {/* MIME icon */}
      <span
        style={{
          fontFamily: "monospace",
          fontSize: 11,
          fontWeight: 700,
          color: iconColor,
          backgroundColor: `${iconColor}22`,
          padding: "4px 8px",
          borderRadius: 4,
          minWidth: 40,
          textAlign: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>

      {/* Filename */}
      <span
        style={{
          flex: 1,
          fontSize: 14,
          fontWeight: 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {entry.filename}
      </span>

      {/* Encryption badge */}
      <EncryptionBadge />

      {/* Tags */}
      {entry.tags.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 4,
            flexShrink: 0,
          }}
          className="locker-tags-hide-mobile"
        >
          {entry.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                backgroundColor: "var(--bg-tertiary)",
                padding: "2px 8px",
                borderRadius: 4,
              }}
            >
              {tag}
            </span>
          ))}
          {entry.tags.length > 3 && (
            <span
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
              }}
            >
              +{entry.tags.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Size */}
      <span
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          minWidth: 70,
          textAlign: "right",
          flexShrink: 0,
        }}
        className="locker-size-hide-mobile"
      >
        {formatBytes(entry.size)}
      </span>

      {/* Date */}
      <span
        style={{
          fontSize: 13,
          color: "var(--text-muted)",
          minWidth: 90,
          textAlign: "right",
          flexShrink: 0,
        }}
        className="locker-date-hide-mobile"
      >
        {formatDate(entry.createdAt)}
      </span>

      {/* Actions */}
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button
          onClick={() => onCopyMagnet(entry.magnetUri)}
          title="Copy magnet link"
          style={{
            padding: "6px 12px",
            borderRadius: "var(--radius)",
            backgroundColor: "var(--bg-tertiary)",
            color: "var(--text-secondary)",
            fontSize: 12,
            fontWeight: 500,
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "var(--bg-tertiary)";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
        >
          Magnet
        </button>
        {onShare && (
          <button
            onClick={() => onShare(entry.id)}
            title="Share with another user"
            style={{
              padding: "6px 12px",
              borderRadius: "var(--radius)",
              backgroundColor: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
              fontSize: 12,
              fontWeight: 500,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--bg-tertiary)";
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            Share
          </button>
        )}
        <a
          href="/downloads/BoilerDeck%20Setup%200.5.0.exe"
          download
          title="Download with BoilerDeck Desktop"
          style={{
            padding: "6px 12px",
            borderRadius: "var(--radius)",
            backgroundColor: "var(--accent)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            transition: "opacity 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        >
          Download
        </a>
      </div>
    </div>
  );
}

// ─── File Card (grid view) ───────────────────────────────────────

function FileCard({
  entry,
  onCopyMagnet,
  onShare,
}: {
  entry: LockerEntry;
  onCopyMagnet: (uri: string) => void;
  onShare?: (entryId: string) => void;
}) {
  const icon = getMimeIcon(entry.mimeType);
  const iconColor = getMimeColor(icon);

  return (
    <div
      style={{
        backgroundColor: "var(--bg-card)",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.borderColor = "var(--accent)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.borderColor = "var(--border)")
      }
    >
      {/* Icon + type */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 48,
        }}
      >
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 16,
            fontWeight: 700,
            color: iconColor,
            backgroundColor: `${iconColor}22`,
            padding: "8px 16px",
            borderRadius: 6,
          }}
        >
          {icon}
        </span>
      </div>

      {/* Filename */}
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "center",
        }}
        title={entry.filename}
      >
        {entry.filename}
      </span>

      {/* Meta */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          color: "var(--text-muted)",
        }}
      >
        <span>{formatBytes(entry.size)}</span>
        <span>{formatDate(entry.createdAt)}</span>
      </div>

      {/* Encryption badge */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <EncryptionBadge />
      </div>

      {/* Tags */}
      {entry.tags.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {entry.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                backgroundColor: "var(--bg-tertiary)",
                padding: "2px 6px",
                borderRadius: 3,
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 6, marginTop: "auto", flexWrap: "wrap" }}>
        <button
          onClick={() => onCopyMagnet(entry.magnetUri)}
          style={{
            flex: 1,
            padding: "6px 0",
            borderRadius: "var(--radius)",
            backgroundColor: "var(--bg-tertiary)",
            color: "var(--text-secondary)",
            fontSize: 12,
            fontWeight: 500,
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "var(--bg-tertiary)";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
        >
          Magnet
        </button>
        {onShare && (
          <button
            onClick={() => onShare(entry.id)}
            style={{
              flex: 1,
              padding: "6px 0",
              borderRadius: "var(--radius)",
              backgroundColor: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
              fontSize: 12,
              fontWeight: 500,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--bg-hover)";
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--bg-tertiary)";
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            Share
          </button>
        )}
        <a
          href="/downloads/BoilerDeck%20Setup%200.5.0.exe"
          download
          style={{
            flex: 1,
            padding: "6px 0",
            borderRadius: "var(--radius)",
            backgroundColor: "var(--accent)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            textDecoration: "none",
            textAlign: "center",
            transition: "opacity 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        >
          Download
        </a>
      </div>
    </div>
  );
}

// ─── Toolbar ─────────────────────────────────────────────────────

function LockerToolbar({
  searchQuery,
  onSearchChange,
  sortField,
  onSortFieldChange,
  sortDir,
  onSortDirChange,
  viewMode,
  onViewModeChange,
}: {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  sortField: SortField;
  onSortFieldChange: (f: SortField) => void;
  sortDir: "asc" | "desc";
  onSortDirChange: (d: "asc" | "desc") => void;
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 16,
        flexWrap: "wrap",
      }}
    >
      {/* Search */}
      <input
        type="text"
        placeholder="Search files..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{
          flex: 1,
          minWidth: 180,
          padding: "8px 12px",
          borderRadius: "var(--radius)",
          border: "1px solid var(--border)",
          backgroundColor: "var(--bg-tertiary)",
          color: "var(--text-primary)",
          fontSize: 13,
          outline: "none",
        }}
      />

      {/* Sort field */}
      <select
        value={sortField}
        onChange={(e) => onSortFieldChange(e.target.value as SortField)}
        style={{
          padding: "8px 12px",
          borderRadius: "var(--radius)",
          border: "1px solid var(--border)",
          backgroundColor: "var(--bg-tertiary)",
          color: "var(--text-primary)",
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        <option value="name">Name</option>
        <option value="size">Size</option>
        <option value="date">Date</option>
      </select>

      {/* Sort direction */}
      <button
        onClick={() => onSortDirChange(sortDir === "asc" ? "desc" : "asc")}
        title={sortDir === "asc" ? "Ascending" : "Descending"}
        style={{
          padding: "8px 10px",
          borderRadius: "var(--radius)",
          border: "1px solid var(--border)",
          backgroundColor: "var(--bg-tertiary)",
          color: "var(--text-secondary)",
          fontSize: 13,
          cursor: "pointer",
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.color = "var(--text-primary)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = "var(--text-secondary)")
        }
      >
        {sortDir === "asc" ? "A-Z" : "Z-A"}
      </button>

      {/* View toggle */}
      <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <button
          onClick={() => onViewModeChange("list")}
          style={{
            padding: "8px 12px",
            backgroundColor:
              viewMode === "list" ? "var(--bg-hover)" : "var(--bg-tertiary)",
            color:
              viewMode === "list"
                ? "var(--text-primary)"
                : "var(--text-muted)",
            fontSize: 12,
            fontWeight: viewMode === "list" ? 600 : 400,
            borderRight: "1px solid var(--border)",
            cursor: "pointer",
          }}
        >
          List
        </button>
        <button
          onClick={() => onViewModeChange("grid")}
          style={{
            padding: "8px 12px",
            backgroundColor:
              viewMode === "grid" ? "var(--bg-hover)" : "var(--bg-tertiary)",
            color:
              viewMode === "grid"
                ? "var(--text-primary)"
                : "var(--text-muted)",
            fontSize: 12,
            fontWeight: viewMode === "grid" ? 600 : 400,
            cursor: "pointer",
          }}
        >
          Grid
        </button>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────

export function LockerPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const {
    entries,
    quota,
    isLoading,
    error,
    viewMode,
    searchQuery,
    sortField,
    sortDir,
    sharedWithMe,
    sharedWithMeLoading,
    fetchEntries,
    shareEntry,
    fetchSharedWithMe,
    setViewMode,
    setSearchQuery,
    setSortField,
    setSortDir,
    clearError,
  } = useLockerStore();

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"my-files" | "shared">("my-files");
  const [shareDialogEntryId, setShareDialogEntryId] = useState<string | null>(null);
  const [shareRecipient, setShareRecipient] = useState("");
  const [shareLoading, setShareLoading] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);

  useEffect(() => {
    if (user) {
      fetchEntries();
      fetchSharedWithMe();
    }
  }, [user, fetchEntries, fetchSharedWithMe]);

  const handleShareConfirm = useCallback(async () => {
    if (!shareDialogEntryId || !shareRecipient) return;
    setShareLoading(true);
    await shareEntry(shareDialogEntryId, shareRecipient);
    setShareLoading(false);
    setShareSuccess(true);
    setTimeout(() => {
      setShareDialogEntryId(null);
      setShareSuccess(false);
    }, 1500);
  }, [shareDialogEntryId, shareRecipient, shareEntry]);

  // ── Auth gate ──

  if (!user) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0" }}>
        <h2 style={{ fontSize: 24, marginBottom: 12, fontWeight: 700 }}>
          Data Locker
        </h2>
        <p
          style={{
            color: "var(--text-secondary)",
            marginBottom: 24,
          }}
        >
          Sign in to access your Data Locker.
        </p>
        <button
          onClick={() => navigate("/login")}
          style={{
            padding: "10px 24px",
            borderRadius: "var(--radius)",
            backgroundColor: "var(--accent)",
            color: "#fff",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Sign In
        </button>
      </div>
    );
  }

  // ── Loading ──

  if (isLoading) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "80px 0",
          color: "var(--text-secondary)",
        }}
      >
        Loading locker...
      </div>
    );
  }

  // ── Filter, sort, search ──

  const filtered = entries.filter((e) =>
    e.filename.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortField === "name") {
      cmp = a.filename.localeCompare(b.filename);
    } else if (sortField === "size") {
      cmp = a.size - b.size;
    } else {
      cmp = a.createdAt - b.createdAt;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  // ── Copy magnet handler ──

  function handleCopyMagnet(magnetUri: string, entryId?: string) {
    navigator.clipboard.writeText(magnetUri).then(() => {
      if (entryId) {
        setCopiedId(entryId);
        setTimeout(() => setCopiedId(null), 2000);
      }
    });
  }

  const shareDialogEntry = shareDialogEntryId
    ? entries.find((e) => e.id === shareDialogEntryId)
    : null;

  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
        Data Locker
      </h2>

      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
        <button
          onClick={() => setActiveTab("my-files")}
          style={{
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: activeTab === "my-files" ? 600 : 400,
            color: activeTab === "my-files" ? "var(--accent)" : "var(--text-muted)",
            backgroundColor: "transparent",
            border: "none",
            borderBottom: activeTab === "my-files" ? "2px solid var(--accent)" : "2px solid transparent",
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
            color: activeTab === "shared" ? "var(--accent)" : "var(--text-muted)",
            backgroundColor: "transparent",
            border: "none",
            borderBottom: activeTab === "shared" ? "2px solid var(--accent)" : "2px solid transparent",
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
              backgroundColor: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: 24,
              width: 420,
              maxWidth: "90%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
              Share File
            </h3>
            {shareDialogEntry && (
              <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
                Sharing: {shareDialogEntry.filename}
              </p>
            )}
            <label style={{ fontSize: 13, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
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
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                fontSize: 13,
                marginBottom: 16,
                boxSizing: "border-box",
              }}
            />
            {shareSuccess && (
              <p style={{ fontSize: 13, color: "var(--accent-green)", marginBottom: 12 }}>
                Shared successfully!
              </p>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setShareDialogEntryId(null)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--border)",
                  backgroundColor: "transparent",
                  color: "var(--text-secondary)",
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
                  borderRadius: "var(--radius)",
                  border: "none",
                  backgroundColor: shareRecipient.length === 64 ? "var(--accent)" : "var(--bg-tertiary)",
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

      {/* Upload banner (my-files tab only) */}
      {activeTab === "my-files" && <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 16px",
          marginBottom: 20,
          borderRadius: "var(--radius)",
          backgroundColor: "rgba(88, 166, 255, 0.08)",
          border: "1px solid rgba(88, 166, 255, 0.2)",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          Upload files from the BoilerDeck Desktop app
        </span>
        <a
          href="/downloads/BoilerDeck%20Setup%200.5.0.exe"
          download
          style={{
            padding: "6px 14px",
            borderRadius: "var(--radius)",
            backgroundColor: "var(--accent-green)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            textDecoration: "none",
            transition: "opacity 0.15s",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        >
          Download Desktop App
        </a>
      </div>}

      {/* Error */}
      {activeTab === "my-files" && error && (
        <div
          style={{
            padding: "10px 16px",
            marginBottom: 16,
            borderRadius: "var(--radius)",
            backgroundColor: "rgba(233, 69, 96, 0.1)",
            border: "1px solid rgba(233, 69, 96, 0.3)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 13, color: "#e94560" }}>{error}</span>
          <button
            onClick={clearError}
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              background: "none",
              cursor: "pointer",
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Quota */}
      {activeTab === "my-files" && quota && <QuotaBar quota={quota} />}

      {/* Toolbar */}
      {activeTab === "my-files" && <LockerToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortField={sortField}
        onSortFieldChange={setSortField}
        sortDir={sortDir}
        onSortDirChange={setSortDir}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />}

      {/* Empty state */}
      {activeTab === "my-files" && entries.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <p
            style={{
              fontSize: 18,
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            Your Data Locker is empty
          </p>
          <p
            style={{
              color: "var(--text-secondary)",
              marginBottom: 24,
              maxWidth: 400,
              margin: "0 auto 24px",
            }}
          >
            Install BoilerDeck Desktop to upload files to your encrypted
            personal storage.
          </p>
          <a
            href="/downloads/BoilerDeck%20Setup%200.5.0.exe"
            download
            style={{
              display: "inline-block",
              padding: "10px 24px",
              borderRadius: "var(--radius)",
              backgroundColor: "var(--accent)",
              color: "#fff",
              fontWeight: 600,
              fontSize: 14,
              textDecoration: "none",
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            Download Desktop App
          </a>
        </div>
      )}

      {/* Search returned no results */}
      {activeTab === "my-files" && entries.length > 0 && sorted.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "40px 0",
            color: "var(--text-secondary)",
          }}
        >
          No files match "{searchQuery}"
        </div>
      )}

      {/* List view */}
      {activeTab === "my-files" && sorted.length > 0 && viewMode === "list" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.map((entry) => (
            <div key={entry.id} style={{ position: "relative" }}>
              <FileRow
                entry={entry}
                onCopyMagnet={(uri) => handleCopyMagnet(uri, entry.id)}
                onShare={(id) => { setShareDialogEntryId(id); setShareRecipient(""); setShareSuccess(false); }}
              />
              {copiedId === entry.id && (
                <span
                  style={{
                    position: "absolute",
                    right: 16,
                    top: -8,
                    fontSize: 11,
                    color: "var(--accent-green)",
                    backgroundColor: "var(--bg-secondary)",
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontWeight: 600,
                    pointerEvents: "none",
                  }}
                >
                  Copied!
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Grid view */}
      {activeTab === "my-files" && sorted.length > 0 && viewMode === "grid" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 12,
          }}
        >
          {sorted.map((entry) => (
            <div key={entry.id} style={{ position: "relative" }}>
              <FileCard
                entry={entry}
                onCopyMagnet={(uri) => handleCopyMagnet(uri, entry.id)}
                onShare={(id) => { setShareDialogEntryId(id); setShareRecipient(""); setShareSuccess(false); }}
              />
              {copiedId === entry.id && (
                <span
                  style={{
                    position: "absolute",
                    right: 8,
                    top: -8,
                    fontSize: 11,
                    color: "var(--accent-green)",
                    backgroundColor: "var(--bg-secondary)",
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontWeight: 600,
                    pointerEvents: "none",
                  }}
                >
                  Copied!
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Shared with me tab */}
      {activeTab === "shared" && (
        <div>
          {sharedWithMeLoading && (
            <div
              style={{
                textAlign: "center",
                padding: "60px 0",
                color: "var(--text-secondary)",
              }}
            >
              Loading shared files...
            </div>
          )}
          {!sharedWithMeLoading && sharedWithMe.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
                No files shared with you
              </p>
              <p style={{ color: "var(--text-secondary)", maxWidth: 400, margin: "0 auto" }}>
                When someone shares a file with you, it will appear here.
              </p>
            </div>
          )}
          {!sharedWithMeLoading && sharedWithMe.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sharedWithMe.map(({ entry, senderPubkey }) => (
                <div
                  key={entry.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    backgroundColor: "var(--bg-card)",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--border)",
                    padding: "10px 16px",
                    transition: "border-color 0.15s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.borderColor = "var(--accent)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.borderColor = "var(--border)")
                  }
                >
                  {/* MIME icon */}
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: 11,
                      fontWeight: 700,
                      color: getMimeColor(getMimeIcon(entry.mimeType)),
                      backgroundColor: `${getMimeColor(getMimeIcon(entry.mimeType))}22`,
                      padding: "4px 8px",
                      borderRadius: 4,
                      minWidth: 40,
                      textAlign: "center",
                      flexShrink: 0,
                    }}
                  >
                    {getMimeIcon(entry.mimeType)}
                  </span>

                  {/* Filename + sender */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {entry.filename}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                      From: {senderPubkey.slice(0, 8)}...{senderPubkey.slice(-8)}
                    </div>
                  </div>

                  {/* Size */}
                  <span
                    style={{
                      fontSize: 13,
                      color: "var(--text-secondary)",
                      minWidth: 70,
                      textAlign: "right",
                      flexShrink: 0,
                    }}
                  >
                    {formatBytes(entry.size)}
                  </span>

                  {/* Date */}
                  <span
                    style={{
                      fontSize: 13,
                      color: "var(--text-muted)",
                      minWidth: 90,
                      textAlign: "right",
                      flexShrink: 0,
                    }}
                  >
                    {formatDate(entry.createdAt)}
                  </span>

                  {/* Actions */}
                  <button
                    onClick={() => handleCopyMagnet(entry.magnetUri, entry.id)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "var(--radius)",
                      backgroundColor: "var(--bg-tertiary)",
                      color: "var(--text-secondary)",
                      fontSize: 12,
                      fontWeight: 500,
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                      e.currentTarget.style.color = "var(--text-primary)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "var(--bg-tertiary)";
                      e.currentTarget.style.color = "var(--text-secondary)";
                    }}
                  >
                    Magnet
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
