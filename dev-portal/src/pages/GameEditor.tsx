import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch, apiUpload, ApiError } from "../api";

interface GameForm {
  title: string;
  description: string;
  priceCents: number;
  exePath: string;
  coverImageUrl: string;
}

interface GameDir {
  name: string;
  files: string[];
}

interface DetectResult {
  directory: string;
  executables: string[];
  recommended: string | null;
}

const EMPTY_FORM: GameForm = {
  title: "",
  description: "",
  priceCents: 0,
  exePath: "",
  coverImageUrl: "",
};

export function GameEditor() {
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const navigate = useNavigate();

  const [form, setForm] = useState<GameForm>(EMPTY_FORM);
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
  const [gameDirs, setGameDirs] = useState<GameDir[]>([]);
  const [dirsLoading, setDirsLoading] = useState(false);
  const [selectedDir, setSelectedDir] = useState<string>("");
  const [detectResult, setDetectResult] = useState<DetectResult | null>(null);
  const [detecting, setDetecting] = useState(false);

  // Revoke cover preview object URL on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!id) return;
    apiFetch<GameForm & { id: string }>(`/developer/games/${id}`)
      .then((game) => {
        setForm({
          title: game.title,
          description: game.description,
          priceCents: game.priceCents,
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
      const data = await apiFetch<{ directories: GameDir[] }>("/developer/game-dirs");
      setGameDirs(data.directories);
      if (data.directories.length === 1) {
        setSelectedDir(data.directories[0].name);
      }
    } catch {
      // Ignore — directories just won't show
    } finally {
      setDirsLoading(false);
    }
  };

  const handleDetect = async (dirname: string) => {
    setDetecting(true);
    setDetectResult(null);
    try {
      const result = await apiFetch<DetectResult>(
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

    // Revoke previous object URL to avoid memory leak
    if (coverPreview) URL.revokeObjectURL(coverPreview);

    // Generate local preview
    const url = URL.createObjectURL(file);
    setCoverPreview(url);

    // If editing an existing game, upload immediately
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
      };
      if (form.exePath) body.exePath = form.exePath;
      if (form.coverImageUrl) body.coverImageUrl = form.coverImageUrl;

      if (isEditing) {
        await apiFetch(`/developer/games/${id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        navigate(`/games/${id}`);
      } else {
        // 1. Create the game
        setUploadState("creating");
        const game = await apiFetch<{ id: string }>("/developer/games", {
          method: "POST",
          body: JSON.stringify(body),
        });

        // 2. Create initial version
        const version = await apiFetch<{ id: string }>(
          `/developer/games/${game.id}/versions`,
          {
            method: "POST",
            body: JSON.stringify({ version: initialVersion }),
          },
        );

        // 3. Upload the zip
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

        // 4. Upload cover image if selected
        if (coverFile) {
          await uploadCover(game.id, coverFile);
        }

        setUploadState("done");
        navigate(`/games/${game.id}`);
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

  const update = <K extends keyof GameForm>(key: K, value: GameForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div style={{ color: "var(--text-secondary)", padding: 40, textAlign: "center" }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <button
        onClick={() => navigate(isEditing ? `/games/${id}` : "/")}
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          backgroundColor: "transparent",
          marginBottom: 16,
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
            borderRadius: "var(--radius)",
            backgroundColor: "rgba(233, 69, 96, 0.1)",
            border: "1px solid rgba(233, 69, 96, 0.3)",
            color: "var(--accent)",
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
            style={{ width: "100%" }}
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
            style={{ width: "100%" }}
          />
        </div>

        {/* Price */}
        <div>
          <label style={labelStyle}>Price (USD)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={(form.priceCents / 100).toFixed(2)}
            onChange={(e) => update("priceCents", Math.round(parseFloat(e.target.value || "0") * 100))}
            style={{ width: "100%" }}
          />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
            Set to 0 for free
          </div>
        </div>

        {/* Copy Protection guidance */}
        <div
          style={{
            padding: 16,
            backgroundColor: "rgba(56, 139, 253, 0.06)",
            border: "1px solid rgba(56, 139, 253, 0.2)",
            borderRadius: "var(--radius)",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
            Copy Protection
          </div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 12 }}>
            BoilerDeck distributes your game build exactly as you upload it via BitTorrent.
            We do not modify, encrypt, or wrap your files in any way. If your game needs
            copy protection, apply it before uploading using your engine's built-in tools.
          </div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 12 }}>
            <strong style={{ color: "var(--text-primary)" }}>Why we don't handle DRM:</strong>{" "}
            Platform-side DRM that wraps your game from the outside (like a launcher check)
            doesn't actually protect your files — they still sit unencrypted on the user's disk.
            Engine-native protection is integrated into your game binary itself, which is
            significantly harder to bypass and requires zero maintenance from us.
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
            Engine-Specific Options
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
            <div style={{ marginBottom: 4 }}>
              <strong>Godot</strong> — Enable PCK encryption in Export &gt; Options. Uses AES-256-CBC with a key
              embedded in a custom export template. Protects all game assets and scripts in the .pck file.
            </div>
            <div style={{ marginBottom: 4 }}>
              <strong>Unity</strong> — Use the IL2CPP scripting backend (converts C# to native code, much harder
              to reverse than Mono/.NET). Enable "Strip Engine Code" to remove unused modules.
              Consider Asset Bundle encryption for premium content.
            </div>
            <div style={{ marginBottom: 4 }}>
              <strong>Unreal Engine</strong> — Enable Pak file encryption in Project Settings &gt; Packaging.
              Uses AES-256 to encrypt all packaged assets. The key is embedded in the executable.
            </div>
            <div>
              <strong>Any Engine</strong> — Third-party tools like Themida, VMProtect, or Enigma Protector
              can wrap any Windows executable with anti-tampering and code virtualization,
              making reverse engineering significantly harder.
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, marginTop: 12, borderTop: "1px solid rgba(56, 139, 253, 0.15)", paddingTop: 10 }}>
            <strong>What BoilerDeck provides:</strong> License tracking (who bought your game),
            Stripe payments with 99/1 revenue split, and BitTorrent distribution.
            Your game's library page shows ownership status — the rest is up to you.
          </div>
        </div>

        {/* Executable — auto-detect (edit mode only, create auto-detects from upload) */}
        {isEditing && <div>
          <label style={labelStyle}>Executable</label>

          {form.exePath ? (
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
                <code style={{ color: "var(--accent-green)" }}>{form.exePath}</code>
              </span>
              <button
                type="button"
                onClick={() => update("exePath", "")}
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
                    setSelectedDir(e.target.value);
                    setDetectResult(null);
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
                  onClick={() => handleDetect(selectedDir)}
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
              onClick={loadGameDirs}
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
        </div>}

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
                  backgroundImage: `url(${coverPreview || form.coverImageUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  border: "1px solid var(--border)",
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
                    backgroundColor: "var(--bg-tertiary)",
                    color: "var(--text-secondary)",
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
                    backgroundColor: "var(--bg-secondary)",
                    color: "var(--text-muted)",
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
                border: "2px dashed var(--border)",
                borderRadius: "var(--radius)",
                padding: 24,
                textAlign: "center",
                cursor: "pointer",
                backgroundColor: "var(--bg-tertiary)",
              }}
            >
              <div style={{ fontSize: 14, color: "var(--text-muted)" }}>
                Drop image here or click to browse
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                JPG, PNG, or WebP — max 10 MB
              </div>
            </div>
          )}
          {/* Cover upload progress (edit mode immediate upload) */}
          {coverUploadState === "uploading" && (
            <div style={{ marginTop: 8 }}>
              <div
                style={{
                  height: 6,
                  backgroundColor: "var(--bg-secondary)",
                  borderRadius: 3,
                  overflow: "hidden",
                  marginBottom: 4,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${coverUploadPercent}%`,
                    backgroundColor: "var(--accent-blue)",
                    borderRadius: 3,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Uploading cover... {coverUploadPercent}%</div>
            </div>
          )}
          {coverUploadState === "error" && (
            <div style={{ fontSize: 12, color: "var(--accent)", marginTop: 6 }}>{coverError}</div>
          )}
          {/* URL fallback toggle */}
          {!showCoverUrl ? (
            <button
              type="button"
              onClick={() => setShowCoverUrl(true)}
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                backgroundColor: "transparent",
                marginTop: 6,
                padding: 0,
                textDecoration: "underline",
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
                style={{ width: "100%", fontSize: 13 }}
              />
              <button
                type="button"
                onClick={() => setShowCoverUrl(false)}
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  backgroundColor: "transparent",
                  marginTop: 4,
                  padding: 0,
                  textDecoration: "underline",
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
                <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                  Version (semver)
                </label>
                <input
                  type="text"
                  value={initialVersion}
                  onChange={(e) => setInitialVersion(e.target.value)}
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
        )}

        {/* Upload progress (create mode) */}
        {!isEditing && uploadState !== "idle" && uploadState !== "error" && (
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

        {/* Actions */}
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <button
            type="submit"
            disabled={saving || (uploadState !== "idle" && uploadState !== "error")}
            style={{
              padding: "12px 24px",
              borderRadius: "var(--radius)",
              backgroundColor: "var(--accent)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving && !isEditing ? "Uploading..." : saving ? "Saving..." : isEditing ? "Save Changes" : "Create Game & Upload"}
          </button>
          <button
            type="button"
            onClick={() => navigate(isEditing ? `/games/${id}` : "/")}
            style={{
              padding: "12px 24px",
              borderRadius: "var(--radius)",
              backgroundColor: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
              fontSize: 14,
            }}
          >
            Cancel
          </button>
        </div>
      </form>
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
