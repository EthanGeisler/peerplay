import type { GameDir, DetectResult } from "../types";

export interface ExeDetectorProps {
  isEditing: boolean;
  exePath: string;
  onExePathChange: (path: string) => void;
  gameDirs: GameDir[];
  dirsLoading: boolean;
  selectedDir: string;
  onSelectedDirChange: (dir: string) => void;
  detectResult: DetectResult | null;
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
            backgroundColor: "var(--bg-tertiary)",
            borderRadius: "var(--radius)",
            border: "1px solid var(--border)",
          }}
        >
          <span style={{ fontSize: 14, flex: 1 }}>
            <code style={{ color: "var(--accent-green)" }}>{exePath}</code>
          </span>
          <button
            type="button"
            onClick={() => onExePathChange("")}
            style={{
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: 4,
              backgroundColor: "var(--bg-secondary)",
              color: "var(--text-muted)",
            }}
          >
            Clear
          </button>
        </div>
      ) : gameDirs.length > 0 ? (
        <div
          style={{
            padding: 16,
            backgroundColor: "var(--bg-tertiary)",
            borderRadius: "var(--radius)",
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <select
              value={selectedDir}
              onChange={(e) => {
                onSelectedDirChange(e.target.value);
                onDetectResultClear();
              }}
              style={{ flex: 1 }}
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
                borderRadius: "var(--radius)",
                backgroundColor: "var(--accent-blue)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                opacity: !selectedDir || detecting ? 0.5 : 1,
              }}
            >
              {detecting ? "Scanning..." : "Detect"}
            </button>
          </div>

          {detectResult && (
            <div>
              {detectResult.executables.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--accent-yellow)" }}>
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
                            : "var(--bg-secondary)",
                        border:
                          exe === detectResult.recommended
                            ? "1px solid rgba(63, 185, 80, 0.3)"
                            : "1px solid var(--border)",
                        color: "var(--text-primary)",
                        fontSize: 13,
                        textAlign: "left",
                      }}
                    >
                      <code style={{ flex: 1 }}>{exe}</code>
                      {exe === detectResult.recommended && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--accent-green)",
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
            borderRadius: "var(--radius)",
            backgroundColor: "var(--bg-tertiary)",
            border: "1px dashed var(--border)",
            color: "var(--accent-blue)",
            fontSize: 14,
            fontWeight: 500,
            opacity: dirsLoading ? 0.6 : 1,
          }}
        >
          {dirsLoading ? "Scanning server..." : "Detect Executable from Server"}
        </button>
      )}

      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
        Scans game files on the server to find the main executable automatically.
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-secondary)",
  marginBottom: 6,
};
