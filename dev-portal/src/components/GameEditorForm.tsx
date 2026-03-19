import type { GameForm, ContentType } from "../types";

const CONTENT_TYPES: { label: string; value: ContentType }[] = [
  { label: "Game", value: "GAME" },
  { label: "Video", value: "VIDEO" },
  { label: "Software", value: "SOFTWARE" },
  { label: "Audio", value: "AUDIO" },
  { label: "Other", value: "OTHER" },
];

export interface GameEditorFormProps {
  form: GameForm;
  isEditing: boolean;
  onUpdate: <K extends keyof GameForm>(key: K, value: GameForm[K]) => void;
  // Cover image props
  coverPreview: string | null;
  coverUploadState: "idle" | "uploading" | "done" | "error";
  coverUploadPercent: number;
  coverError: string | null;
  showCoverUrl: boolean;
  onCoverFileSelected: (file: File) => void;
  onCoverRemove: () => void;
  onShowCoverUrl: (show: boolean) => void;
}

export function GameEditorForm({
  form,
  isEditing,
  onUpdate,
  coverPreview,
  coverUploadState,
  coverUploadPercent,
  coverError,
  showCoverUrl,
  onCoverFileSelected,
  onCoverRemove,
  onShowCoverUrl,
}: GameEditorFormProps) {
  const contentType = form.contentType || "GAME";
  const showExeRelated = contentType === "GAME" || contentType === "SOFTWARE";

  return (
    <>
      {/* Content Type */}
      <div>
        <label style={labelStyle}>Content Type</label>
        <div style={{ display: "flex", gap: 8 }}>
          {CONTENT_TYPES.map((ct) => (
            <button
              key={ct.value}
              type="button"
              disabled={isEditing}
              onClick={() => onUpdate("contentType", ct.value)}
              style={{
                padding: "6px 16px",
                borderRadius: 20,
                fontSize: 13,
                fontWeight: 600,
                border: "1px solid",
                cursor: isEditing ? "not-allowed" : "pointer",
                borderColor: contentType === ct.value ? "var(--accent)" : "var(--border)",
                backgroundColor: contentType === ct.value ? "var(--accent)" : "transparent",
                color: contentType === ct.value ? "#fff" : "var(--text-secondary)",
                opacity: isEditing ? 0.6 : 1,
                transition: "all 0.15s",
              }}
            >
              {ct.label}
            </button>
          ))}
        </div>
        {isEditing && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
            Content type cannot be changed after creation.
          </div>
        )}
      </div>

      {/* Title */}
      <div>
        <label style={labelStyle}>Title *</label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => onUpdate("title", e.target.value)}
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
          onChange={(e) => onUpdate("description", e.target.value)}
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
          onChange={(e) => onUpdate("priceCents", Math.round(parseFloat(e.target.value || "0") * 100))}
          style={{ width: "100%" }}
        />
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
          Set to 0 for free
        </div>
      </div>

      {/* Copy Protection guidance — only for games/software */}
      {showExeRelated && <div
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
                    if (input.files?.[0]) onCoverFileSelected(input.files[0]);
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
                onClick={onCoverRemove}
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
              if (file && file.type.startsWith("image/") && /\.(jpe?g|png|webp)$/i.test(file.name)) onCoverFileSelected(file);
            }}
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/jpeg,image/png,image/webp";
              input.onchange = () => {
                if (input.files?.[0]) onCoverFileSelected(input.files[0]);
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
        {/* Cover upload progress */}
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
            onClick={() => onShowCoverUrl(true)}
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
                onUpdate("coverImageUrl", e.target.value);
                onCoverRemove();
              }}
              placeholder="https://..."
              style={{ width: "100%", fontSize: 13 }}
            />
            <button
              type="button"
              onClick={() => onShowCoverUrl(false)}
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
