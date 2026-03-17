import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch, ApiError } from "../../api";
import { apiUpload } from "../../devApi";
import { resolveCoverUrl } from "../../utils";
import type { DevGameForm, DevGameDir, DevDetectResult } from "../../types";

const EMPTY_FORM: DevGameForm = {
  title: "",
  description: "",
  priceCents: 0,
  drmTier: "NONE",
  exePath: "",
  coverImageUrl: "",
};

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

export function DevGameEditor() {
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const navigate = useNavigate();

  const [form, setForm] = useState<DevGameForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Upload state (create mode only)
  const [initialVersion, setInitialVersion] = useState("1.0.0");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<"idle" | "creating" | "uploading" | "processing" | "done" | "error">("idle");
  const [uploadPercent, setUploadPercent] = useState(0);

  // Cover image upload state
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverUploadState, setCoverUploadState] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [coverUploadPercent, setCoverUploadPercent] = useState(0);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [showCoverUrl, setShowCoverUrl] = useState(false);

  // Exe detection state
  const [gameDirs, setGameDirs] = useState<DevGameDir[]>([]);
  const [dirsLoading, setDirsLoading] = useState(false);
  const [selectedDir, setSelectedDir] = useState<string>("");
  const [detectResult, setDetectResult] = useState<DevDetectResult | null>(null);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    return () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    apiFetch<DevGameForm & { id: string; coverImageUrl: string | null; exePath: string | null }>(`/developer/games/${id}`)
      .then((game) => {
        setForm({
          title: game.title,
          description: game.description,
          priceCents: game.priceCents,
          drmTier: game.drmTier,
          exePath: game.exePath || "",
          coverImageUrl: game.coverImageUrl || "",
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load game"))
      .finally(() => setLoading(false));
  }, [id]);

  const loadGameDirs = async () => {
    setDirsLoading(true);
    try {
      const data = await apiFetch<{ directories: DevGameDir[] }>("/developer/game-dirs");
      setGameDirs(data.directories);
      if (data.directories.length === 1) {
        setSelectedDir(data.directories[0].name);
      }
    } catch {
      // Ignore
    } finally {
      setDirsLoading(false);
    }
  };

  const handleDetect = async (dirname: string) => {
    setDetecting(true);
    setDetectResult(null);
    try {
      const result = await apiFetch<DevDetectResult>(
        `/developer/game-dirs/${encodeURIComponent(dirname)}/executables`,
      );
      setDetectResult(result);
      if (result.recommended) {
        setForm((prev) => ({ ...prev, exePath: result.recommended! }));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to detect executable");
    } finally {
      setDetecting(false);
    }
  };

  const uploadCover = async (gameId: string, file: File) => {
    setCoverUploadState("uploading");
    setCoverUploadPercent(0);
    setCoverError(null);
    const fd = new FormData();
    fd.append("coverImage", file);
    try {
      const result = await apiUpload<{ coverImageUrl: string }>(
        `/developer/games/${gameId}/cover`,
        fd,
        (percent) => setCoverUploadPercent(percent),
      );
      setCoverUploadState("done");
      update("coverImageUrl", result.coverImageUrl);
      setCoverFile(null);
    } catch (err: unknown) {
      setCoverUploadState("error");
      setCoverError(err instanceof Error ? err.message : "Cover upload failed");
    }
  };

  const handleCoverFileSelected = (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setCoverError("File exceeds 10 MB limit");
      setCoverUploadState("error");
      return;
    }
    setCoverFile(file);
    setCoverError(null);
    setCoverUploadState("idle");

    if (coverPreview) URL.revokeObjectURL(coverPreview);

    const url = URL.createObjectURL(file);
    setCoverPreview(url);

    if (isEditing && id) {
      uploadCover(id, file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isEditing && !zipFile) {
      setError("Please select a .zip file for your game build");
      return;
    }

    setSaving(true);

    try {
      const body: Record<string, unknown> = {
        title: form.title,
        description: form.description,
        priceCents: form.priceCents,
        drmTier: form.drmTier,
      };
      if (form.exePath) body.exePath = form.exePath;
      if (form.coverImageUrl) body.coverImageUrl = form.coverImageUrl;

      if (isEditing) {
        await apiFetch(`/developer/games/${id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        navigate(`/developer/games/${id}`);
      } else {
        setUploadState("creating");
        const game = await apiFetch<{ id: string }>("/developer/games", {
          method: "POST",
          body: JSON.stringify(body),
        });

        const version = await apiFetch<{ id: string }>(
          `/developer/games/${game.id}/versions`,
          {
            method: "POST",
            body: JSON.stringify({ version: initialVersion }),
          },
        );

        setUploadState("uploading");
        setUploadPercent(0);
        const formData = new FormData();
        formData.append("gameZip", zipFile!);

        await apiUpload(
          `/developer/games/${game.id}/versions/${version.id}/upload`,
          formData,
          (percent) => {
            setUploadPercent(percent);
            if (percent === 100) {
              setUploadState("processing");
            }
          },
        );

        if (coverFile) {
          await uploadCover(game.id, coverFile);
        }

        setUploadState("done");
        navigate(`/developer/games/${game.id}`);
      }
    } catch (err: unknown) {
      setUploadState("error");
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong");
      }
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof DevGameForm>(key: K, value: DevGameForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div style={{ color: "#aaa", padding: 40, textAlign: "center" }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <button
        onClick={() => navigate(isEditing ? `/developer/games/${id}` : "/developer")}
        style={{
          fontSize: 13,
          color: "#aaa",
          backgroundColor: "transparent",
          marginBottom: 16,
          border: "none",
          cursor: "pointer",
        }}
      >
        &larr; Back
      </button>

      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>
        {isEditing ? "Edit Game" : "New Game"}
      </h1>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            backgroundColor: "rgba(233, 69, 96, 0.1)",
            border: "1px solid rgba(233, 69, 96, 0.3)",
            color: "#e94560",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Title */}
        <div>
          <label style={labelStyle}>Title *</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            placeholder="My Awesome Game"
            required
            maxLength={200}
            style={inputStyle}
          />
        </div>

        {/* Description */}
        <div>
          <label style={labelStyle}>Description</label>
          <textarea
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="Describe your game..."
            maxLength={5000}
            rows={5}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>

        {/* Price + DRM row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={labelStyle}>Price (USD)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={(form.priceCents / 100).toFixed(2)}
              onChange={(e) => update("priceCents", Math.round(parseFloat(e.target.value || "0") * 100))}
              style={inputStyle}
            />
            <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
              Set to 0 for free
            </div>
          </div>

          <div>
            <label style={labelStyle}>DRM Tier</label>
            <select
              value={form.drmTier}
              onChange={(e) => update("drmTier", e.target.value as DevGameForm["drmTier"])}
              style={inputStyle}
            >
              <option value="NONE">DRM-Free</option>
              <option value="LIGHT">Light (Online Check)</option>
              <option value="ENCRYPTED">Encrypted (AES-256)</option>
            </select>
            <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
              {form.drmTier === "NONE" && "No copy protection. Players own their files."}
              {form.drmTier === "LIGHT" && "Online license check at launch, max 3 devices."}
              {form.drmTier === "ENCRYPTED" && "Game files encrypted, key delivered per-user."}
            </div>
          </div>
        </div>

        {/* Executable — auto-detect (edit mode only) */}
        {isEditing && (
          <div>
            <label style={labelStyle}>Executable</label>

            {form.exePath ? (
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
                  <code style={{ color: "#3fb950" }}>{form.exePath}</code>
                </span>
                <button
                  type="button"
                  onClick={() => update("exePath", "")}
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
                      setSelectedDir(e.target.value);
                      setDetectResult(null);
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
                    onClick={() => handleDetect(selectedDir)}
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
                            onClick={() => update("exePath", exe)}
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
                onClick={loadGameDirs}
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
        )}

        {/* Cover Image */}
        <div>
          <label style={labelStyle}>Cover Image</label>
          {coverPreview || form.coverImageUrl ? (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
              <div
                style={{
                  width: 200,
                  height: 94,
                  borderRadius: 6,
                  backgroundImage: `url(${coverPreview || resolveCoverUrl(form.coverImageUrl)})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  border: "1px solid #0f3460",
                  flexShrink: 0,
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "image/jpeg,image/png,image/webp";
                    input.onchange = () => {
                      if (input.files?.[0]) handleCoverFileSelected(input.files[0]);
                    };
                    input.click();
                  }}
                  style={{
                    fontSize: 12,
                    padding: "4px 10px",
                    borderRadius: 4,
                    backgroundColor: "#0f3460",
                    color: "#aaa",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Change
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCoverFile(null);
                    setCoverPreview(null);
                    update("coverImageUrl", "");
                  }}
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
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const file = e.dataTransfer.files[0];
                if (file && file.type.startsWith("image/") && /\.(jpe?g|png|webp)$/i.test(file.name)) handleCoverFileSelected(file);
              }}
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = "image/jpeg,image/png,image/webp";
                input.onchange = () => {
                  if (input.files?.[0]) handleCoverFileSelected(input.files[0]);
                };
                input.click();
              }}
              style={{
                border: "2px dashed #0f3460",
                borderRadius: 8,
                padding: 24,
                textAlign: "center",
                cursor: "pointer",
                backgroundColor: "#0f3460",
              }}
            >
              <div style={{ fontSize: 14, color: "#888" }}>
                Drop image here or click to browse
              </div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                JPG, PNG, or WebP — max 10 MB
              </div>
            </div>
          )}
          {coverUploadState === "uploading" && (
            <div style={{ marginTop: 8 }}>
              <div
                style={{
                  height: 6,
                  backgroundColor: "#16213e",
                  borderRadius: 3,
                  overflow: "hidden",
                  marginBottom: 4,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${coverUploadPercent}%`,
                    backgroundColor: "#58a6ff",
                    borderRadius: 3,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
              <div style={{ fontSize: 11, color: "#888" }}>Uploading cover... {coverUploadPercent}%</div>
            </div>
          )}
          {coverUploadState === "error" && (
            <div style={{ fontSize: 12, color: "#e94560", marginTop: 6 }}>{coverError}</div>
          )}
          {!showCoverUrl ? (
            <button
              type="button"
              onClick={() => setShowCoverUrl(true)}
              style={{
                fontSize: 11,
                color: "#888",
                backgroundColor: "transparent",
                marginTop: 6,
                padding: 0,
                textDecoration: "underline",
                border: "none",
                cursor: "pointer",
              }}
            >
              or enter URL manually
            </button>
          ) : (
            <div style={{ marginTop: 8 }}>
              <input
                type="url"
                value={form.coverImageUrl}
                onChange={(e) => {
                  update("coverImageUrl", e.target.value);
                  setCoverFile(null);
                  setCoverPreview(null);
                }}
                placeholder="https://..."
                style={{ ...inputStyle, fontSize: 13 }}
              />
              <button
                type="button"
                onClick={() => setShowCoverUrl(false)}
                style={{
                  fontSize: 11,
                  color: "#888",
                  backgroundColor: "transparent",
                  marginTop: 4,
                  padding: 0,
                  textDecoration: "underline",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                hide URL input
              </button>
            </div>
          )}
        </div>

        {/* Game Build (create mode only) */}
        {!isEditing && (
          <div>
            <label style={labelStyle}>Game Build *</label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#888", marginBottom: 4 }}>
                  Version (semver)
                </label>
                <input
                  type="text"
                  value={initialVersion}
                  onChange={(e) => setInitialVersion(e.target.value)}
                  placeholder="1.0.0"
                  pattern="^\d+\.\d+\.\d+$"
                  required
                  style={inputStyle}
                />
              </div>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const file = e.dataTransfer.files[0];
                if (file && file.name.endsWith(".zip")) setZipFile(file);
              }}
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".zip";
                input.onchange = () => {
                  if (input.files?.[0]) setZipFile(input.files[0]);
                };
                input.click();
              }}
              style={{
                border: "2px dashed #0f3460",
                borderRadius: 8,
                padding: 24,
                textAlign: "center",
                cursor: "pointer",
                backgroundColor: "#0f3460",
              }}
            >
              {zipFile ? (
                <div>
                  <div style={{ fontSize: 14, color: "#e0e0e0", fontWeight: 600 }}>
                    {zipFile.name}
                  </div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
                    {(zipFile.size / (1024 * 1024)).toFixed(1)} MB
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 14, color: "#888" }}>
                  Drop .zip here or click to browse
                </div>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
              Zip your game folder and upload it. The server will extract it, create a torrent, and start seeding automatically.
            </div>
          </div>
        )}

        {/* Upload progress (create mode) */}
        {!isEditing && uploadState !== "idle" && uploadState !== "error" && (
          <div
            style={{
              padding: 20,
              backgroundColor: "#0f3460",
              borderRadius: 8,
              textAlign: "center",
            }}
          >
            {uploadState === "creating" && (
              <div style={{ fontSize: 14, color: "#aaa" }}>Creating game...</div>
            )}
            {uploadState === "uploading" && (
              <>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
                  Uploading v{initialVersion}...
                </div>
                <div
                  style={{
                    height: 8,
                    backgroundColor: "#16213e",
                    borderRadius: 4,
                    overflow: "hidden",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${uploadPercent}%`,
                      backgroundColor: "#e94560",
                      borderRadius: 4,
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
                <div style={{ fontSize: 13, color: "#888" }}>{uploadPercent}%</div>
                <div style={{ fontSize: 12, color: "#888", marginTop: 8 }}>
                  Do not close this window.
                </div>
              </>
            )}
            {uploadState === "processing" && (
              <>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
                  Processing — creating torrent & seeding
                </div>
                <div style={{ fontSize: 24, letterSpacing: 4, color: "#888" }}>...</div>
              </>
            )}
            {uploadState === "done" && (
              <div style={{ fontSize: 14, color: "#3fb950", fontWeight: 600 }}>
                Done! Redirecting...
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <button
            type="submit"
            disabled={saving || (uploadState !== "idle" && uploadState !== "error")}
            style={{
              padding: "12px 24px",
              borderRadius: 8,
              backgroundColor: "#e94560",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              opacity: saving ? 0.7 : 1,
              border: "none",
              cursor: "pointer",
            }}
          >
            {saving && !isEditing ? "Uploading..." : saving ? "Saving..." : isEditing ? "Save Changes" : "Create Game & Upload"}
          </button>
          <button
            type="button"
            onClick={() => navigate(isEditing ? `/developer/games/${id}` : "/developer")}
            style={{
              padding: "12px 24px",
              borderRadius: 8,
              backgroundColor: "#0f3460",
              color: "#aaa",
              fontSize: 14,
              border: "none",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
