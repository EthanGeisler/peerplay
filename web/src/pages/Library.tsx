import { useNavigate } from "react-router-dom";
import { useAppStore } from "../stores/appStore";

export function Library() {
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);
  const login = useAppStore((s) => s.login);
  const getOwnedGames = useAppStore((s) => s.getOwnedGames);

  if (!user) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0" }}>
        <h2 style={{ fontSize: 24, marginBottom: 12, fontWeight: 700 }}>Your Library</h2>
        <p style={{ color: "var(--text-secondary)", marginBottom: 24 }}>
          Sign in to see your games.
        </p>
        <button
          onClick={() => login("player@peerplay.io")}
          style={{
            padding: "10px 24px",
            borderRadius: "var(--radius)",
            backgroundColor: "var(--accent)",
            color: "#fff",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Sign In (Demo)
        </button>
      </div>
    );
  }

  const ownedGames = getOwnedGames();

  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Your Library</h2>

      {ownedGames.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
            Your library is empty. Browse the store to find games.
          </p>
          <button
            onClick={() => navigate("/")}
            style={{
              padding: "10px 24px",
              borderRadius: "var(--radius)",
              backgroundColor: "var(--accent)",
              color: "#fff",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Browse Store
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {ownedGames.map((game) => (
            <div
              key={game.id}
              onClick={() => navigate(`/game/${game.slug}`)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                backgroundColor: "var(--bg-card)",
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--border)",
                padding: 12,
                cursor: "pointer",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
            >
              <img
                src={game.coverImageUrl}
                alt={game.title}
                style={{
                  width: 120,
                  height: 56,
                  objectFit: "cover",
                  borderRadius: "var(--radius)",
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{game.title}</h3>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{game.studioName}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--accent-green)",
                    backgroundColor: "rgba(63,185,80,0.15)",
                    padding: "4px 10px",
                    borderRadius: 4,
                    fontWeight: 600,
                  }}
                >
                  Ready
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    alert(
                      `In the full desktop client, this would launch ${game.exePath} via BitTorrent download + local execution.`,
                    );
                  }}
                  style={{
                    padding: "8px 20px",
                    borderRadius: "var(--radius)",
                    backgroundColor: "var(--accent-green)",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  Play
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
