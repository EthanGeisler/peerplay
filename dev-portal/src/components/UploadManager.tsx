export interface UploadManagerProps {
  isEditing: boolean;
  initialVersion: string;
  onInitialVersionChange: (version: string) => void;
  zipFile: File | null;
  onZipFileChange: (file: File | null) => void;
  uploadState: "idle" | "creating" | "uploading" | "processing" | "done" | "error";
  uploadPercent: number;
}

export function UploadManager({
  isEditing,
  initialVersion,
  onInitialVersionChange,
  zipFile,
  onZipFileChange,
  uploadState,
  uploadPercent,
}: UploadManagerProps) {
  if (isEditing) return null;

  return (
    <>
      {/* Game Build (create mode only) */}
      <div>
        <label style={labelStyle}>Game Build *</label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
              Version (semver)
            </label>
            <input
              type="text"
              value={initialVersion}
              onChange={(e) => onInitialVersionChange(e.target.value)}
              placeholder="1.0.0"
              pattern="^\d+\.\d+\.\d+$"
              required
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const file = e.dataTransfer.files[0];
            if (file && file.name.endsWith(".zip")) onZipFileChange(file);
          }}
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".zip";
            input.onchange = () => {
              if (input.files?.[0]) onZipFileChange(input.files[0]);
            };
            input.click();
          }}
          style={{
            border: "2px dashed var(--border)",
            borderRadius: "var(--radius)",
            padding: 24,
            textAlign: "center",
            cursor: "pointer",
            backgroundColor: "var(--bg-tertiary)",
          }}
        >
          {zipFile ? (
            <div>
              <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 600 }}>
                {zipFile.name}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                {(zipFile.size / (1024 * 1024)).toFixed(1)} MB
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 14, color: "var(--text-muted)" }}>
              Drop .zip here or click to browse
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
          Zip your game folder and upload it. The server will extract it, create a torrent, and start seeding automatically.
        </div>
      </div>

      {/* Upload progress (create mode) */}
      {uploadState !== "idle" && uploadState !== "error" && (
        <div
          style={{
            padding: 20,
            backgroundColor: "var(--bg-tertiary)",
            borderRadius: "var(--radius)",
            textAlign: "center",
          }}
        >
          {uploadState === "creating" && (
            <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>Creating game...</div>
          )}
          {uploadState === "uploading" && (
            <>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
                Uploading v{initialVersion}...
              </div>
              <div
                style={{
                  height: 8,
                  backgroundColor: "var(--bg-secondary)",
                  borderRadius: 4,
                  overflow: "hidden",
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${uploadPercent}%`,
                    backgroundColor: "var(--accent)",
                    borderRadius: 4,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{uploadPercent}%</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                Do not close this page.
              </div>
            </>
          )}
          {uploadState === "processing" && (
            <>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
                Processing — creating torrent & seeding
              </div>
              <div style={{ fontSize: 24, letterSpacing: 4, color: "var(--text-muted)" }}>...</div>
            </>
          )}
          {uploadState === "done" && (
            <div style={{ fontSize: 14, color: "var(--accent-green)", fontWeight: 600 }}>
              Done! Redirecting...
            </div>
          )}
        </div>
      )}
    </>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-secondary)",
  marginBottom: 6,
};
