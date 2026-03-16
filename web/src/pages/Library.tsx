import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useLibraryStore } from "../stores/libraryStore";

const PLACEHOLDER_COVER = "https://placehold.co/120x56/0d1117/58a6ff?text=No+Cover&font=raleway";

export function Library() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { licenses, loading, fetchLicenses } = useLibraryStore();

  useEffect(() => {
    if (user) fetchLicenses();
  }, [user, fetchLicenses]);

  if (!user) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0" }}>
        <h2 style={{ fontSize: 24, marginBottom: 12, fontWeight: 700 }}>Your Library</h2>
        <p style={{ color: "var(--text-secondary)", marginBottom: 24 }}>
          Sign in to see your games.
        </p>
        <button
          onClick={() => navigate("/login")}
          style={{
            padding: "10px 24px",
            borderRadius: "var(--radius)",
            backgroundColor: "var(--accent)",
            color: "#fff",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Sign In
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0", color: "var(--text-secondary)" }}>
        Loading library...
      </div>
    );
  }

  const activeLicenses = licenses.filter((l) => l.status === "ACTIVE");

  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Your Library</h2>

      {activeLicenses.length === 0 ? (
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
          {activeLicenses.map((license) => (
            <div
              key={license.id}
              onClick={() => navigate(`/game/${license.game.slug}`)}
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
                src={license.game.coverImageUrl || PLACEHOLDER_COVER}
                alt={license.game.title}
                style={{
                  width: 120,
                  height: 56,
                  objectFit: "cover",
                  borderRadius: "var(--radius)",
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{license.game.title}</h3>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{license.game.studioName}</span>
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
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
