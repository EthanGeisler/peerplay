import { useNavigate } from "react-router-dom";
import { MOCK_GAMES } from "../data/mock";
import { useAppStore } from "../stores/appStore";

function formatPrice(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

function getDrmBadge(game: (typeof MOCK_GAMES)[number]): {
  label: string;
  color: string;
  bg: string;
} {
  // For games with editions, show the lowest DRM tier
  const tier =
    game.editions && game.editions.length > 0
      ? game.editions.reduce((lowest, ed) => {
          const order = { NONE: 0, LIGHT: 1, ENCRYPTED: 2 } as const;
          return order[ed.drmTier] < order[lowest] ? ed.drmTier : lowest;
        }, game.editions[0].drmTier)
      : game.drmTier;

  switch (tier) {
    case "NONE":
      return { label: "DRM-Free", color: "#3fb950", bg: "rgba(63,185,80,0.15)" };
    case "LIGHT":
      return { label: "Online Check", color: "#d29922", bg: "rgba(210,153,34,0.15)" };
    case "ENCRYPTED":
      return { label: "Encrypted", color: "#58a6ff", bg: "rgba(88,166,255,0.15)" };
  }
}

export function Store() {
  const navigate = useNavigate();
  const isOwned = useAppStore((s) => s.isOwned);
  const featured = MOCK_GAMES.find((g) => g.featured);

  return (
    <div>
      {/* Featured game hero */}
      {featured && (
        <div
          onClick={() => navigate(`/game/${featured.slug}`)}
          style={{
            background: "linear-gradient(135deg, #1a0028 0%, #0d1117 50%, #001a1a 100%)",
            borderRadius: "var(--radius-lg)",
            padding: "40px",
            marginBottom: 32,
            border: "1px solid var(--border)",
            position: "relative",
            overflow: "hidden",
            cursor: "pointer",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 32,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
        >
          <div>
            <span style={tagStyle("#e94560", "rgba(233,69,96,0.2)")}>FEATURED</span>
            <h1
              style={{
                fontSize: 32,
                fontWeight: 800,
                marginTop: 12,
                marginBottom: 12,
                color: "var(--text-primary)",
              }}
            >
              {featured.title}
            </h1>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 20 }}>
              {featured.description}
            </p>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
              <span
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  color: "var(--accent-green)",
                }}
              >
                Free
              </span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {featured.fileSizeMB}MB &middot; DRM-Free &middot; v{featured.version}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {featured.tags.map((tag) => (
                <span key={tag} style={tagStyle("var(--text-secondary)", "var(--bg-tertiary)")}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img
              src={featured.coverImageUrl}
              alt={featured.title}
              style={{
                width: "100%",
                maxWidth: 420,
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--border)",
              }}
            />
          </div>
        </div>
      )}

      {/* Platform info */}
      <div style={{ display: "flex", gap: 12, marginBottom: 32 }}>
        <span style={tagStyle("#3fb950", "rgba(63,185,80,0.15)")}>99/1 Revenue Split</span>
        <span style={tagStyle("#58a6ff", "rgba(88,166,255,0.15)")}>BitTorrent Powered</span>
        <span style={tagStyle("#d29922", "rgba(210,153,34,0.15)")}>Developer Choice DRM</span>
      </div>

      {/* Game grid */}
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, color: "var(--text-primary)" }}>
        Browse Games
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 20,
        }}
      >
        {MOCK_GAMES.map((game) => {
          const owned = isOwned(game.id);
          return (
            <div
              key={game.id}
              onClick={() => navigate(`/game/${game.slug}`)}
              style={{
                backgroundColor: "var(--bg-card)",
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--border)",
                overflow: "hidden",
                cursor: "pointer",
                transition: "transform 0.15s, border-color 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.borderColor = "var(--accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <img
                src={game.coverImageUrl}
                alt={game.title}
                style={{ width: "100%", height: 140, objectFit: "cover", display: "block" }}
              />
              <div style={{ padding: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700 }}>{game.title}</h3>
                  {owned && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--accent-green)",
                        backgroundColor: "rgba(63,185,80,0.15)",
                        padding: "2px 8px",
                        borderRadius: 4,
                      }}
                    >
                      Owned
                    </span>
                  )}
                </div>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    lineHeight: 1.5,
                    marginBottom: 12,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {game.description}
                </p>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{game.studioName}</span>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: game.priceCents === 0 ? "var(--accent-green)" : "var(--text-primary)",
                    }}
                  >
                    {formatPrice(game.priceCents)}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                  {(() => {
                    const badge = getDrmBadge(game);
                    return (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: badge.color,
                          backgroundColor: badge.bg,
                          padding: "2px 8px",
                          borderRadius: 4,
                        }}
                      >
                        {badge.label}
                      </span>
                    );
                  })()}
                  {game.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        backgroundColor: "var(--bg-tertiary)",
                        padding: "2px 8px",
                        borderRadius: 4,
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function tagStyle(color: string, bg: string): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 600,
    color,
    backgroundColor: bg,
    padding: "4px 12px",
    borderRadius: 20,
  };
}
