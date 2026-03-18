import type { DevGameDir, DevDetectResult } from "../../types";

export interface ExeDetectorProps {
  isEditing: boolean;
  exePath: string;
  onExePathChange: (path: string) => void;
  gameDirs: DevGameDir[];
  dirsLoading: boolean;
  selectedDir: string;
  onSelectedDirChange: (dir: string) => void;
  detectResult: DevDetectResult | null;
  onDetectResultClear: () => void;
  detecting: boolean;
  onLoadGameDirs: () => void;
  onDetect: (dirname: string) => void;
}

export function ExeDetector({
  isEditing,
  exePath,
  onExePathChange,
  gameDirs,
  dirsLoading,
  selectedDir,
  onSelectedDirChange,
  detectResult,
  onDetectResultClear,
  detecting,
  onLoadGameDirs,
  onDetect,
}: ExeDetectorProps) {
  if (!isEditing) return null;

  return (
    <div>
      <label style={labelStyle}>Executable</label>

      {exePath ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            backgroundColor: "#0f3460",
            borderRadius: 8,
            border: "1px solid #0f3460",
          }}
        >
          <span style={{ fontSize: 14, flex: 1 }}>
            <code style={{ color: "#3fb950" }}>{exePath}</code>
          </span>
          <button
            type="button"
            onClick={() => onExePathChange("")}
            style={{
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: 4,
              backgroundColor: "#16213e",
              color: "#888",
              border: "none",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        </div>
      ) : gameDirs.length > 0 ? (
        <div
          style={{
            padding: 16,
            backgroundColor: "#0f3460",
            borderRadius: 8,
            border: "1px solid #0f3460",
          }}
        >
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <select
              value={selectedDir}
              onChange={(e) => {
                onSelectedDirChange(e.target.value);
                onDetectResultClear();
              }}
              style={{ ...inputStyle, flex: 1 }}
            >
              <option value="">Select game folder...</option>
              {gameDirs.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}/ ({d.files.length} files)
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selectedDir || detecting}
              onClick={() => onDetect(selectedDir)}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                backgroundColor: "#58a6ff",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                opacity: !selectedDir || detecting ? 0.5 : 1,
                border: "none",
                cursor: "pointer",
              }}
            >
              {detecting ? "Scanning..." : "Detect"}
            </button>
          </div>

          {detectResult && (
            <div>
              {detectResult.executables.length === 0 ? (
                <div style={{ fontSize: 13, color: "#d29922" }}>
                  No .exe files found in {detectResult.directory}/
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {detectResult.executables.map((exe) => (
                    <button
                      key={exe}
                      type="button"
                      onClick={() => onExePathChange(exe)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        borderRadius: 6,
                        backgroundColor:
                          exe === detectResult.recommended
                            ? "rgba(63, 185, 80, 0.1)"
                            : "#16213e",
                        border:
                          exe === detectResult.recommended
                            ? "1px solid rgba(63, 185, 80, 0.3)"
                            : "1px solid #0f3460",
                        color: "#e0e0e0",
                        fontSize: 13,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <code style={{ flex: 1 }}>{exe}</code>
                      {exe === detectResult.recommended && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "#3fb950",
                            fontWeight: 600,
                          }}
                        >
                          Recommended
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={onLoadGameDirs}
          disabled={dirsLoading}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 8,
            backgroundColor: "#0f3460",
            border: "1px dashed #0f3460",
            color: "#58a6ff",
            fontSize: 14,
            fontWeight: 500,
            opacity: dirsLoading ? 0.6 : 1,
            cursor: "pointer",
          }}
        >
          {dirsLoading ? "Scanning server..." : "Detect Executable from Server"}
        </button>
      )}

      <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
        Scans game files on the server to find the main executable automatically.
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #0f3460",
  backgroundColor: "#0f3460",
  color: "#e0e0e0",
  fontSize: 14,
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "#aaa",
  marginBottom: 6,
};
