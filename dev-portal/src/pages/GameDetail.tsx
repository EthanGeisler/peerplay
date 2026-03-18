import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch, apiUpload, ApiError } from "../api";
import type { GameVersion, GameData } from "../types";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "var(--text-muted)",
  PENDING_REVIEW: "var(--accent-yellow)",
  PUBLISHED: "var(--accent-green)",
  SUSPENDED: "var(--accent)",
};

const VERSION_STATUS_COLORS: Record<string, string> = {
  PROCESSING: "var(--accent-yellow)",
  READY: "var(--accent-green)",
  FAILED: "var(--accent)",
};

export function GameDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [game, setGame] = useState<GameData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Cover upload state
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverPercent, setCoverPercent] = useState(0);
  const [coverError, setCoverError] = useState<string | null>(null);

  // New version form + upload
  const [showVersionForm, setShowVersionForm] = useState(false);
  const [newVersion, setNewVersion] = useState("");
  const [versionError, setVersionError] = useState<string | null>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "processing" | "done" | "error">("idle");
  const [uploadPercent, setUploadPercent] = useState(0);

  const loadGame = () => {
    apiFetch<GameData>(`/developer/games/${id}`)
      .then(setGame)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadGame();
  }, [id]);

  const handleCoverUpload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        setCoverError("File exceeds 10 MB limit");
        return;
      }
      setCoverUploading(true);
      setCoverPercent(0);
      setCoverError(null);
      const fd = new FormData();
      fd.append("cover", file);
      try {
        await apiUpload(
          `/developer/games/${id}/cover`,
          fd,
          (percent) => setCoverPercent(percent),
        );
        setCoverUploading(false);
        loadGame();
      } catch (err: unknown) {
        setCoverUploading(false);
        setCoverError(err instanceof Error ? err.message : "Cover upload failed");
      }
    };
    input.click();
  };

  const handlePublish = async () => {
    setActionLoading(true);
    try {
      await apiFetch(`/developer/games/${id}/publish`, { method: "PATCH" });
      loadGame();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to publish");
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnpublish = async () => {
    setActionLoading(true);
    try {
      await apiFetch(`/developer/games/${id}/unpublish`, { method: "PATCH" });
      loadGame();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to unpublish");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    setVersionError(null);

    if (!zipFile) {
      setVersionError("Please select a .zip file");
      return;
    }

    try {
      // 1. Create version record (gets PROCESSING status)
      const created = await apiFetch<{ id: string }>(`/developer/games/${id}/versions`, {
        method: "POST",
        body: JSON.stringify({ version: newVersion }),
      });

      // 2. Upload the zip file
      setUploadState("uploading");
      setUploadPercent(0);

      const formData = new FormData();
      formData.append("gameZip", zipFile);

      setUploadState("uploading");
      await apiUpload(
        `/developer/games/${id}/versions/${created.id}/upload`,
        formData,
        (percent) => {
          setUploadPercent(percent);
          if (percent === 100) {
            setUploadState("processing");
          }
        },
      );

      setUploadState("done");
      setNewVersion("");
      setZipFile(null);
      setShowVersionForm(false);
      setUploadState("idle");
      loadGame();
    } catch (err: unknown) {
      setUploadState("error");
      if (err instanceof ApiError) {
        setVersionError(err.message);
      } else {
        setVersionError("Failed to create version");
      }
    }
  };

  if (loading) {
    return <div style={{ color: "var(--text-secondary)", padding: 40, textAlign: "center" }}>Loading...</div>;
  }

  if (error || !game) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <div style={{ color: "var(--accent)", marginBottom: 16 }}>{error || "Game not found"}</div>
        <button
          onClick={() => navigate("/")}
          style={{ color: "var(--accent-blue)", backgroundColor: "transparent", fontSize: 14 }}
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  return (
    <div>
      <button
        onClick={() => navigate("/")}
        style={{ fontSize: 13, color: "var(--text-secondary)", backgroundColor: "transparent", marginBottom: 16 }}
      >
        &larr; Back to Dashboard
      </button>

      {/* Header */}
      <div
        style={{
          display: "flex",
          gap: 20,
          alignItems: "flex-start",
          marginBottom: 32,
        }}
      >
        <div style={{ flexShrink: 0, position: "relative" }}>
          <div
            style={{
              width: 160,
              height: 75,
              borderRadius: "var(--radius)",
              backgroundColor: "var(--bg-tertiary)",
              backgroundImage: game.coverImageUrl ? `url(${game.coverImageUrl})` : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {!game.coverImageUrl && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>No cover</span>
            )}
          </div>
          {coverUploading ? (
            <div style={{ marginTop: 4 }}>
              <div
                style={{
                  height: 4,
                  backgroundColor: "var(--bg-secondary)",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${coverPercent}%`,
                    backgroundColor: "var(--accent-blue)",
                    borderRadius: 2,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{coverPercent}%</div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleCoverUpload}
              style={{
                marginTop: 4,
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 4,
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                width: "100%",
              }}
            >
              {game.coverImageUrl ? "Change Cover" : "Upload Cover"}
            </button>
          )}
          {coverError && (
            <div style={{ fontSize: 10, color: "var(--accent)", marginTop: 2 }}>{coverError}</div>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>{game.title}</h1>
            <span
              style={{
                fontSize: 11,
                padding: "4px 10px",
                borderRadius: 4,
                backgroundColor: "rgba(255,255,255,0.05)",
                color: STATUS_COLORS[game.status] ?? "var(--text-secondary)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {game.status.replace("_", " ")}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Slug: {game.slug} &middot; Created {formatDate(game.createdAt)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => navigate(`/games/${id}/edit`)}
            style={{
              padding: "8px 16px",
              borderRadius: "var(--radius)",
              backgroundColor: "var(--bg-tertiary)",
              color: "var(--text-primary)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Edit
          </button>
          {game.status === "DRAFT" || game.status === "SUSPENDED" ? (
            <button
              onClick={handlePublish}
              disabled={actionLoading}
              style={{
                padding: "8px 16px",
                borderRadius: "var(--radius)",
                backgroundColor: "var(--accent-green)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                opacity: actionLoading ? 0.7 : 1,
              }}
            >
              Publish
            </button>
          ) : game.status === "PUBLISHED" ? (
            <button
              onClick={handleUnpublish}
              disabled={actionLoading}
              style={{
                padding: "8px 16px",
                borderRadius: "var(--radius)",
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--accent-yellow)",
                fontSize: 13,
                fontWeight: 600,
                opacity: actionLoading ? 0.7 : 1,
              }}
            >
              Unpublish
            </button>
          ) : null}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 32 }}>
        {[
          { label: "Price", value: game.priceCents === 0 ? "Free" : `$${(game.priceCents / 100).toFixed(2)}` },
          { label: "Licenses", value: game.licensesCount },
          { label: "Sales", value: game.salesCount },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: 16,
            }}
          >
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
              {stat.label}
            </div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Game Details section */}
      <Section title="Game Details">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <DetailRow label="Executable" value={game.exePath || "Not set"} />
          <DetailRow label="Save Paths" value={game.savePaths.length > 0 ? game.savePaths.join(", ") : "None"} />
          <DetailRow label="Screenshots" value={`${game.screenshots.length} image${game.screenshots.length !== 1 ? "s" : ""}`} />
          <DetailRow label="Last Updated" value={formatDate(game.updatedAt)} />
        </div>
        {game.description && (
          <div style={{ marginTop: 16, fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            {game.description}
          </div>
        )}
      </Section>

      {/* Versions section */}
      <Section
        title="Versions"
        action={
          <button
            onClick={() => setShowVersionForm(true)}
            style={{
              fontSize: 13,
              padding: "6px 14px",
              borderRadius: "var(--radius)",
              backgroundColor: "var(--bg-tertiary)",
              color: "var(--text-primary)",
              fontWeight: 600,
            }}
          >
            + New Version
          </button>
        }
      >
        {showVersionForm && (
          uploadState === "uploading" || uploadState === "processing" ? (
            <div
              style={{
                marginBottom: 16,
                padding: 20,
                backgroundColor: "var(--bg-tertiary)",
                borderRadius: "var(--radius)",
                textAlign: "center",
              }}
            >
              {uploadState === "uploading" ? (
                <>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
                    Uploading v{newVersion}...
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
              ) : (
                <>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
                    Processing — creating torrent & seeding
                  </div>
                  <div style={{ fontSize: 24, letterSpacing: 4, color: "var(--text-muted)" }}>
                    ...
                  </div>
                </>
              )}
            </div>
          ) : (
            <form
              onSubmit={handleCreateVersion}
              style={{
                marginBottom: 16,
                padding: 16,
                backgroundColor: "var(--bg-tertiary)",
                borderRadius: "var(--radius)",
              }}
            >
              <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                    Version (semver)
                  </label>
                  <input
                    type="text"
                    value={newVersion}
                    onChange={(e) => setNewVersion(e.target.value)}
                    placeholder="1.0.0"
                    pattern="^\d+\.\d+\.\d+$"
                    required
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              {/* Drop zone */}
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
                  marginBottom: 12,
                  backgroundColor: "var(--bg-secondary)",
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

              {versionError && (
                <div style={{ fontSize: 12, color: "var(--accent)", marginBottom: 12 }}>{versionError}</div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="submit"
                  style={{
                    padding: "10px 16px",
                    borderRadius: "var(--radius)",
                    backgroundColor: "var(--accent)",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  Upload & Create Version
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowVersionForm(false);
                    setVersionError(null);
                    setZipFile(null);
                    setUploadState("idle");
                  }}
                  style={{
                    padding: "10px 16px",
                    borderRadius: "var(--radius)",
                    backgroundColor: "var(--bg-secondary)",
                    color: "var(--text-secondary)",
                    fontSize: 13,
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )
        )}

        {game.versions.length === 0 ? (
          <div style={{ fontSize: 14, color: "var(--text-muted)", padding: 16, textAlign: "center" }}>
            No versions yet. Create a version to start distributing your game.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {game.versions.map((ver) => (
              <div
                key={ver.id}
                style={{
                  padding: 16,
                  backgroundColor: "var(--bg-tertiary)",
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>v{ver.version}</span>
                  <span
                    style={{
                      fontSize: 11,
                      padding: "3px 8px",
                      borderRadius: 4,
                      backgroundColor: "rgba(255,255,255,0.05)",
                      color: VERSION_STATUS_COLORS[ver.status] ?? "var(--text-secondary)",
                      fontWeight: 600,
                    }}
                  >
                    {ver.status}
                  </span>
                  {ver.fileSizeBytes > 0 && (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {formatBytes(ver.fileSizeBytes)}
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
                    {formatDate(ver.createdAt)}
                  </span>
                </div>

                {/* Torrent / Download info */}
                {ver.torrent ? (
                  <div
                    style={{
                      padding: 12,
                      backgroundColor: "var(--bg-secondary)",
                      borderRadius: 6,
                      fontSize: 13,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ color: "var(--accent-green)", fontWeight: 600 }}>Torrent Active</span>
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 4 }}>
                      Info Hash: <code style={{ color: "var(--text-secondary)" }}>{ver.torrent.infoHash}</code>
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                      Magnet URI:{" "}
                      <code
                        style={{
                          color: "var(--text-secondary)",
                          wordBreak: "break-all",
                          display: "inline-block",
                          maxWidth: "100%",
                        }}
                      >
                        {ver.torrent.magnetUri.length > 80
                          ? ver.torrent.magnetUri.slice(0, 80) + "..."
                          : ver.torrent.magnetUri}
                      </code>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: 12,
                      backgroundColor: "rgba(210, 153, 34, 0.05)",
                      borderRadius: 6,
                      fontSize: 13,
                      color: "var(--accent-yellow)",
                    }}
                  >
                    No torrent linked. Use the publish-game script to create and link a torrent for this version.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        backgroundColor: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 20,
        marginBottom: 20,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>{value}</div>
    </div>
  );
}
