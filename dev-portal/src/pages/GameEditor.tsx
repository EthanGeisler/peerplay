import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch, apiUpload, ApiError } from "../api";
import type { GameForm, GameDir, DetectResult } from "../types";
import { GameEditorForm } from "../components/GameEditorForm";
import { UploadManager } from "../components/UploadManager";
import { ExeDetector } from "../components/ExeDetector";

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
    fd.append("cover", file);
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

  const handleCoverRemove = () => {
    setCoverFile(null);
    setCoverPreview(null);
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
      if (form.contentType) body.contentType = form.contentType;

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
        {isEditing ? "Edit Listing" : "New Listing"}
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
        <GameEditorForm
          form={form}
          isEditing={isEditing}
          onUpdate={update}
          coverPreview={coverPreview}
          coverUploadState={coverUploadState}
          coverUploadPercent={coverUploadPercent}
          coverError={coverError}
          showCoverUrl={showCoverUrl}
          onCoverFileSelected={handleCoverFileSelected}
          onCoverRemove={handleCoverRemove}
          onShowCoverUrl={setShowCoverUrl}
        />

        {(form.contentType || "GAME") === "GAME" || form.contentType === "SOFTWARE" ? (
          <ExeDetector
            isEditing={isEditing}
            exePath={form.exePath}
            onExePathChange={(path) => update("exePath", path)}
            gameDirs={gameDirs}
            dirsLoading={dirsLoading}
            selectedDir={selectedDir}
            onSelectedDirChange={setSelectedDir}
            detectResult={detectResult}
            onDetectResultClear={() => setDetectResult(null)}
            detecting={detecting}
            onLoadGameDirs={loadGameDirs}
            onDetect={handleDetect}
          />
        ) : null}

        <UploadManager
          isEditing={isEditing}
          initialVersion={initialVersion}
          onInitialVersionChange={setInitialVersion}
          zipFile={zipFile}
          onZipFileChange={setZipFile}
          uploadState={uploadState}
          uploadPercent={uploadPercent}
        />

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
            {saving && !isEditing ? "Uploading..." : saving ? "Saving..." : isEditing ? "Save Changes" : "Create Listing & Upload"}
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
