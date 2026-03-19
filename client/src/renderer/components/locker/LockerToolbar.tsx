import { useState, useRef, useEffect } from "react";
import type { ViewMode, SortField, SortDir } from "../../stores/lockerStore";

interface LockerToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  sortField: SortField;
  sortDir: SortDir;
  onSortFieldChange: (field: SortField) => void;
  onSortDirChange: (dir: SortDir) => void;
  onUploadFile: () => void;
  onUploadDirectory: () => void;
  isLoading: boolean;
}

const styles = {
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
    flexWrap: "wrap",
  } as React.CSSProperties,
  searchInput: {
    padding: "8px 12px",
    fontSize: 13,
    backgroundColor: "#0d1b2a",
    border: "1px solid #0f3460",
    borderRadius: 4,
    color: "#e0e0e0",
    outline: "none",
    minWidth: 200,
    flex: 1,
    maxWidth: 320,
  } as React.CSSProperties,
  uploadBtn: {
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    border: "none",
    borderRadius: 4,
    backgroundColor: "#e94560",
    color: "#fff",
    cursor: "pointer",
    position: "relative",
  } as React.CSSProperties,
  dropdown: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    backgroundColor: "#16213e",
    border: "1px solid #0f3460",
    borderRadius: 4,
    overflow: "hidden",
    zIndex: 100,
    minWidth: 160,
    boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
  } as React.CSSProperties,
  dropdownItem: {
    padding: "10px 14px",
    fontSize: 13,
    color: "#e0e0e0",
    cursor: "pointer",
    border: "none",
    background: "none",
    width: "100%",
    textAlign: "left",
    display: "block",
  } as React.CSSProperties,
  viewToggle: {
    display: "flex",
    gap: 0,
    border: "1px solid #0f3460",
    borderRadius: 4,
    overflow: "hidden",
  } as React.CSSProperties,
  viewBtn: (active: boolean) => ({
    padding: "6px 10px",
    fontSize: 13,
    border: "none",
    backgroundColor: active ? "#0f3460" : "transparent",
    color: active ? "#fff" : "#888",
    cursor: "pointer",
    fontWeight: active ? 600 : 400,
  }) as React.CSSProperties,
  sortSelect: {
    padding: "6px 10px",
    fontSize: 13,
    backgroundColor: "#0d1b2a",
    border: "1px solid #0f3460",
    borderRadius: 4,
    color: "#e0e0e0",
    outline: "none",
    cursor: "pointer",
  } as React.CSSProperties,
  sortDirBtn: {
    padding: "6px 8px",
    fontSize: 13,
    backgroundColor: "transparent",
    border: "1px solid #0f3460",
    borderRadius: 4,
    color: "#888",
    cursor: "pointer",
  } as React.CSSProperties,
};

export function LockerToolbar({
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  sortField,
  sortDir,
  onSortFieldChange,
  onSortDirChange,
  onUploadFile,
  onUploadDirectory,
  isLoading,
}: LockerToolbarProps) {
  const [showUploadDropdown, setShowUploadDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showUploadDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowUploadDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showUploadDropdown]);

  return (
    <div style={styles.toolbar}>
      {/* Upload button with dropdown */}
      <div ref={dropdownRef} style={{ position: "relative" }}>
        <button
          style={styles.uploadBtn as React.CSSProperties}
          onClick={() => setShowUploadDropdown(!showUploadDropdown)}
          disabled={isLoading}
        >
          + Upload
        </button>
        {showUploadDropdown && (
          <div style={styles.dropdown as React.CSSProperties}>
            <button
              style={styles.dropdownItem as React.CSSProperties}
              onClick={() => {
                setShowUploadDropdown(false);
                onUploadFile();
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#0f3460"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              Upload File
            </button>
            <button
              style={styles.dropdownItem as React.CSSProperties}
              onClick={() => {
                setShowUploadDropdown(false);
                onUploadDirectory();
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#0f3460"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              Upload Folder
            </button>
          </div>
        )}
      </div>

      {/* Search input */}
      <input
        type="text"
        style={styles.searchInput}
        placeholder="Search files..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
      />

      {/* Sort dropdown */}
      <select
        style={styles.sortSelect}
        value={sortField}
        onChange={(e) => onSortFieldChange(e.target.value as SortField)}
      >
        <option value="name">Name</option>
        <option value="size">Size</option>
        <option value="date">Date</option>
      </select>

      {/* Sort direction */}
      <button
        style={styles.sortDirBtn}
        onClick={() => onSortDirChange(sortDir === "asc" ? "desc" : "asc")}
        title={sortDir === "asc" ? "Ascending" : "Descending"}
      >
        {sortDir === "asc" ? "A-Z" : "Z-A"}
      </button>

      {/* View toggle */}
      <div style={styles.viewToggle}>
        <button
          style={styles.viewBtn(viewMode === "grid")}
          onClick={() => onViewModeChange("grid")}
          title="Grid view"
        >
          Grid
        </button>
        <button
          style={styles.viewBtn(viewMode === "list")}
          onClick={() => onViewModeChange("list")}
          title="List view"
        >
          List
        </button>
      </div>
    </div>
  );
}
