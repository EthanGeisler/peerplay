import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch, ApiError } from "../api";

interface GameForm {
  title: string;
  description: string;
  priceCents: number;
  drmTier: "NONE" | "LIGHT" | "ENCRYPTED";
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
  drmTier: "NONE",
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

  // Exe detection state
  const [gameDirs, setGameDirs] = useState<GameDir[]>([]);
  const [dirsLoading, setDirsLoading] = useState(false);
  const [selectedDir, setSelectedDir] = useState<string>("");
  const [detectResult, setDetectResult] = useState<DetectResult | null>(null);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    if (!id) return;
    apiFetch<GameForm & { id: string }>(`/developer/games/${id}`)
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

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
        navigate(`/games/${id}`);
      } else {
        const game = await apiFetch<{ id: string }>("/developer/games", {
          method: "POST",
          body: JSON.stringify(body),
        });
        navigate(`/games/${game.id}`);
      }
    } catch (err: unknown) {
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
              style={{ width: "100%" }}
            />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Set to 0 for free
            </div>
          </div>

          <div>
            <label style={labelStyle}>DRM Tier</label>
            <select
              value={form.drmTier}
              onChange={(e) => update("drmTier", e.target.value as GameForm["drmTier"])}
              style={{ width: "100%" }}
            >
              <option value="NONE">DRM-Free</option>
              <option value="LIGHT">Light (Online Check)</option>
              <option value="ENCRYPTED">Encrypted (AES-256)</option>
            </select>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              {form.drmTier === "NONE" && "No copy protection. Players own their files."}
              {form.drmTier === "LIGHT" && "Online license check at launch, max 3 devices."}
              {form.drmTier === "ENCRYPTED" && "Game files encrypted, key delivered per-user."}
            </div>
          </div>
        </div>

        {/* Executable — auto-detect */}
        <div>
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
        </div>

        {/* Cover image URL */}
        <div>
          <label style={labelStyle}>Cover Image URL</label>
          <input
            type="url"
            value={form.coverImageUrl}
            onChange={(e) => update("coverImageUrl", e.target.value)}
            placeholder="https://..."
            style={{ width: "100%" }}
          />
          {form.coverImageUrl && (
            <div
              style={{
                marginTop: 8,
                width: 200,
                height: 94,
                borderRadius: 6,
                backgroundImage: `url(${form.coverImageUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                border: "1px solid var(--border)",
              }}
            />
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <button
            type="submit"
            disabled={saving}
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
            {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Game"}
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
