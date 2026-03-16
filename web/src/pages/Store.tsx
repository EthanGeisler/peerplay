import { useNavigate } from "react-router-dom";
import { MOCK_GAMES } from "../data/mock";
import { useAppStore } from "../stores/appStore";

function formatPrice(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

export function Store() {
  const navigate = useNavigate();
  const isOwned = useAppStore((s) => s.isOwned);

  return (
    <div>
      {/* Hero banner */}
      <div
        style={{
          background: "linear-gradient(135deg, #1a0028 0%, #0d1117 50%, #001a1a 100%)",
          borderRadius: "var(--radius-lg)",
          padding: "48px 40px",
          marginBottom: 32,
          border: "1px solid var(--border)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -50,
            right: -50,
            width: 200,
            height: 200,
            background: "radial-gradient(circle, var(--accent) 0%, transparent 70%)",
            opacity: 0.1,
          }}
        />
        <h1
          style={{
            fontSize: 36,
            fontWeight: 800,
            marginBottom: 12,
            background: "linear-gradient(90deg, var(--accent), var(--accent-blue))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Welcome to Peerplay
        </h1>
        <p style={{ fontSize: 16, color: "var(--text-secondary)", maxWidth: 600, lineHeight: 1.6 }}>
          Decentralized game distribution powered by BitTorrent.
          Developers keep 99% of revenue. No gatekeepers. Open platform.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <span style={tagStyle("#3fb950", "rgba(63,185,80,0.15)")}>99/1 Revenue Split</span>
          <span style={tagStyle("#58a6ff", "rgba(88,166,255,0.15)")}>BitTorrent Powered</span>
          <span style={tagStyle("#d29922", "rgba(210,153,34,0.15)")}>Developer Choice DRM</span>
        </div>
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
                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
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
