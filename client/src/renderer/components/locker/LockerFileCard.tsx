import { useState, useRef, useEffect } from "react";
import type { LockerIndexEntry, DownloadStatus } from "../../stores/lockerStore";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getFileIcon(mimeType: string, filename: string): string {
  if (mimeType.startsWith("image/")) return "[IMG]";
  if (mimeType.startsWith("video/")) return "[VID]";
  if (mimeType.startsWith("audio/")) return "[AUD]";
  if (mimeType.startsWith("text/")) return "[TXT]";
  if (mimeType === "application/pdf") return "[PDF]";
  if (mimeType === "application/zip" || filename.endsWith(".zip") || filename.endsWith(".7z") || filename.endsWith(".rar")) return "[ZIP]";
  if (filename.endsWith(".exe") || filename.endsWith(".msi")) return "[EXE]";
  return "[FILE]";
}

function getStatusBadge(status: DownloadStatus, downloadPercent?: number): { text: string; color: string } {
  switch (status) {
    case "available":
      return { text: "Cloud", color: "#58a6ff" };
    case "downloading":
      return { text: `${downloadPercent != null ? downloadPercent.toFixed(0) : 0}%`, color: "#d29922" };
    case "downloaded":
      return { text: "Local", color: "#3fb950" };
    case "seeding":
      return { text: "Seeding", color: "#3fb950" };
    case "error":
      return { text: "Error", color: "#e94560" };
    default:
      return { text: "", color: "#888" };
  }
}

interface LockerFileCardProps {
  entry: LockerIndexEntry;
  viewMode: "grid" | "list";
  downloadPercent?: number;
  isSelfCustody?: boolean;
  isSelected?: boolean;
  onDownload: (entryId: string) => void;
  onDelete: (entryId: string) => void;
  onOpen: (filePath: string) => void;
  onShowInFolder: (filePath: string) => void;
  onCopyInfoHash: (infoHash: string) => void;
  onShare?: (entryId: string) => void;
  onClick?: (e: React.MouseEvent, entryId: string) => void;
}

const gridStyles = {
  card: {
    backgroundColor: "#16213e",
    borderRadius: 8,
    overflow: "hidden",
    border: "1px solid #0f3460",
    cursor: "pointer",
    transition: "border-color 0.15s",
  } as React.CSSProperties,
  iconArea: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: 80,
    backgroundColor: "#0d1b2a",
    fontSize: 20,
    fontWeight: 700,
    color: "#555",
    fontFamily: "monospace",
    letterSpacing: 1,
  } as React.CSSProperties,
  body: {
    padding: "10px 12px",
  } as React.CSSProperties,
  filename: {
    fontSize: 13,
    fontWeight: 600,
    color: "#fff",
    marginBottom: 4,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } as React.CSSProperties,
  meta: {
    fontSize: 11,
    color: "#888",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  } as React.CSSProperties,
  badge: (color: string) => ({
    fontSize: 10,
    fontWeight: 600,
    color,
    padding: "2px 6px",
    backgroundColor: `${color}22`,
    borderRadius: 3,
  }) as React.CSSProperties,
  progressBar: {
    width: "100%",
    height: 3,
    backgroundColor: "#0d1b2a",
    borderRadius: 2,
    overflow: "hidden",
    marginTop: 6,
  } as React.CSSProperties,
};

const listStyles = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    backgroundColor: "#16213e",
    borderRadius: 4,
    border: "1px solid #0f3460",
    marginBottom: 4,
    cursor: "pointer",
    transition: "border-color 0.15s",
  } as React.CSSProperties,
  icon: {
    fontSize: 12,
    fontWeight: 700,
    color: "#555",
    fontFamily: "monospace",
    minWidth: 40,
    textAlign: "center",
  } as React.CSSProperties,
  filename: {
    fontSize: 13,
    fontWeight: 600,
    color: "#fff",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } as React.CSSProperties,
  size: {
    fontSize: 12,
    color: "#888",
    minWidth: 70,
    textAlign: "right",
  } as React.CSSProperties,
  date: {
    fontSize: 12,
    color: "#888",
    minWidth: 90,
    textAlign: "right",
  } as React.CSSProperties,
};

const contextMenuStyles = {
  menu: {
    position: "fixed",
    backgroundColor: "#16213e",
    border: "1px solid #0f3460",
    borderRadius: 4,
    overflow: "hidden",
    zIndex: 200,
    minWidth: 180,
    boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
  } as React.CSSProperties,
  item: {
    padding: "8px 14px",
    fontSize: 13,
    color: "#e0e0e0",
    cursor: "pointer",
    border: "none",
    background: "none",
    width: "100%",
    textAlign: "left",
    display: "block",
  } as React.CSSProperties,
  itemDanger: {
    color: "#e94560",
  } as React.CSSProperties,
  separator: {
    height: 1,
    backgroundColor: "#0f3460",
    margin: "2px 0",
  } as React.CSSProperties,
};

function EncryptionBadge({ isSelfCustody }: { isSelfCustody: boolean }) {
  const label = isSelfCustody ? "End-to-end encrypted" : "Server-managed encryption";
  const color = isSelfCustody ? "#3fb950" : "#d29922";
  return (
    <span
      title={
        isSelfCustody
          ? "Your metadata is encrypted with your local key. The server cannot read filenames, tags, or file associations."
          : "Your metadata is encrypted but the server manages your key. For stronger privacy, enable self-custody in Settings."
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10,
        fontWeight: 600,
        color,
        padding: "2px 6px",
        backgroundColor: `${color}18`,
        borderRadius: 3,
        cursor: "help",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: 11 }}>[E]</span>
      {label}
    </span>
  );
}

export function LockerFileCard({
  entry,
  viewMode,
  downloadPercent,
  isSelfCustody = false,
  isSelected = false,
  onDownload,
  onDelete,
  onOpen,
  onShowInFolder,
  onCopyInfoHash,
  onShare,
  onClick,
}: LockerFileCardProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleClick = (e: React.MouseEvent) => {
    // If onClick handler provided (for selection), delegate to it
    if (onClick) {
      onClick(e, entry.entryId);
      return;
    }
    // Default behavior: open/download
    if (entry.downloadStatus === "downloaded" || entry.downloadStatus === "seeding") {
      if (entry.localPath) onOpen(entry.localPath);
    } else if (entry.downloadStatus === "available") {
      onDownload(entry.entryId);
    }
  };

  const badge = getStatusBadge(entry.downloadStatus, downloadPercent);
  const icon = getFileIcon(entry.mimeType, entry.filename);

  const renderContextMenu = () => {
    if (!contextMenu) return null;
    return (
      <div
        ref={menuRef}
        style={{ ...contextMenuStyles.menu, left: contextMenu.x, top: contextMenu.y } as React.CSSProperties}
      >
        {(entry.downloadStatus === "available" || entry.downloadStatus === "error") && (
          <button
            style={contextMenuStyles.item as React.CSSProperties}
            onClick={() => { setContextMenu(null); onDownload(entry.entryId); }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#0f3460"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            Download
          </button>
        )}
        {(entry.downloadStatus === "downloaded" || entry.downloadStatus === "seeding") && entry.localPath && (
          <>
            <button
              style={contextMenuStyles.item as React.CSSProperties}
              onClick={() => { setContextMenu(null); onOpen(entry.localPath!); }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#0f3460"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              Open
            </button>
            <button
              style={contextMenuStyles.item as React.CSSProperties}
              onClick={() => { setContextMenu(null); onShowInFolder(entry.localPath!); }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#0f3460"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              Show in Folder
            </button>
          </>
        )}
        <button
          style={contextMenuStyles.item as React.CSSProperties}
          onClick={() => { setContextMenu(null); onCopyInfoHash(entry.infoHash); }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#0f3460"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
        >
          Copy Info Hash
        </button>
        {onShare && (
          <button
            style={contextMenuStyles.item as React.CSSProperties}
            onClick={() => { setContextMenu(null); onShare(entry.entryId); }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#0f3460"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            Share
          </button>
        )}
        <div style={contextMenuStyles.separator} />
        <button
          style={{ ...contextMenuStyles.item, ...contextMenuStyles.itemDanger } as React.CSSProperties}
          onClick={() => { setContextMenu(null); onDelete(entry.entryId); }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#0f3460"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
        >
          Delete
        </button>
      </div>
    );
  };

  const selectedBorder = isSelected ? "#e94560" : "#0f3460";
  const selectedBg = isSelected ? "#e9456015" : undefined;

  if (viewMode === "list") {
    return (
      <>
        <div
          style={{ ...listStyles.row, borderColor: selectedBorder, backgroundColor: selectedBg || listStyles.row.backgroundColor }}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "#e94560"; }}
          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "#0f3460"; }}
        >
          <span style={listStyles.icon as React.CSSProperties}>{icon}</span>
          <span style={listStyles.filename as React.CSSProperties}>{entry.filename}</span>
          <EncryptionBadge isSelfCustody={isSelfCustody} />
          <span style={gridStyles.badge(badge.color)}>{badge.text}</span>
          <span style={listStyles.size as React.CSSProperties}>{formatSize(entry.size)}</span>
          <span style={listStyles.date as React.CSSProperties}>{formatDate(entry.createdAt)}</span>
        </div>
        {renderContextMenu()}
      </>
    );
  }

  // Grid view
  return (
    <>
      <div
        style={{ ...gridStyles.card, borderColor: selectedBorder, backgroundColor: selectedBg || gridStyles.card.backgroundColor }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "#e94560"; }}
        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "#0f3460"; }}
      >
        <div style={gridStyles.iconArea}>{icon}</div>
        <div style={gridStyles.body}>
          <div style={gridStyles.filename as React.CSSProperties}>{entry.filename}</div>
          <div style={gridStyles.meta}>
            <span>{formatSize(entry.size)}</span>
            <span style={gridStyles.badge(badge.color)}>{badge.text}</span>
          </div>
          <div style={{ ...gridStyles.meta, marginTop: 4 }}>
            <span>{formatDate(entry.createdAt)}</span>
          </div>
          <div style={{ marginTop: 4 }}>
            <EncryptionBadge isSelfCustody={isSelfCustody} />
          </div>
          {entry.downloadStatus === "downloading" && (
            <div style={gridStyles.progressBar}>
              <div style={{
                height: "100%",
                width: `${downloadPercent ?? 0}%`,
                backgroundColor: "#d29922",
                borderRadius: 2,
                transition: "width 0.3s ease",
              }} />
            </div>
          )}
        </div>
      </div>
      {renderContextMenu()}
    </>
  );
}
