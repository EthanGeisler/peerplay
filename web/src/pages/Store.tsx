import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useGameStore } from "../stores/gameStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useAuthStore } from "../stores/authStore";
import { formatPrice, PLACEHOLDER_COVER } from "../utils";
import type { ApiGame } from "../types";

function getDrmBadge(tier: ApiGame["drmTier"]): {
  label: string;
  color: string;
  bg: string;
} {
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
  const games = useGameStore((s) => s.games);
  const loading = useGameStore((s) => s.loading);
  const fetchGames = useGameStore((s) => s.fetchGames);
  const licenses = useLibraryStore((s) => s.licenses);
  const fetchLicenses = useLibraryStore((s) => s.fetchLicenses);
  const user = useAuthStore((s) => s.user);

  const [searchQuery, setSearchQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  const handleSearch = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchGames(value || undefined);
      }, 300);
    },
    [fetchGames],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (user) fetchLicenses();
  }, [user, fetchLicenses]);

  if (loading && games.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0", color: "var(--text-secondary)" }}>
        Loading games...
      </div>
    );
  }

  const isSearching = searchQuery.trim().length > 0;
  const featured = games[0];

  return (
    <div>
      {/* Search bar */}
      <div style={{ marginBottom: 24 }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search games..."
          style={{
            width: "100%",
            padding: "12px 16px",
            fontSize: 15,
            backgroundColor: "var(--bg-card)",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            outline: "none",
            transition: "border-color 0.15s",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
        />
      </div>

      {/* Featured game hero */}
      {!isSearching && featured && (
        <div
          role="link"
          tabIndex={0}
          onClick={() => navigate(`/game/${featured.slug}`)}
          onKeyDown={(e) => { if (e.key === "Enter") navigate(`/game/${featured.slug}`); }}
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
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  color: featured.priceCents === 0 ? "var(--accent-green)" : "var(--text-primary)",
                }}
              >
                {formatPrice(featured.priceCents)}
              </span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                by {featured.studioName}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img
              src={featured.coverImageUrl || PLACEHOLDER_COVER}
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
      {!isSearching && (
        <div style={{ display: "flex", gap: 12, marginBottom: 32 }}>
          <span style={tagStyle("#3fb950", "rgba(63,185,80,0.15)")}>99/1 Revenue Split</span>
          <span style={tagStyle("#58a6ff", "rgba(88,166,255,0.15)")}>BitTorrent Powered</span>
          <span style={tagStyle("#d29922", "rgba(210,153,34,0.15)")}>Developer Choice DRM</span>
        </div>
      )}

      {/* Game grid */}
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, color: "var(--text-primary)" }}>
        {isSearching ? `Results for "${searchQuery}"` : "Browse Games"}
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 20,
        }}
      >
        {games.map((game) => {
          const owned = licenses.some((l) => l.game.id === game.id && l.status === "ACTIVE");
          const badge = getDrmBadge(game.drmTier);
          return (
            <div
              key={game.id}
              role="link"
              tabIndex={0}
              onClick={() => navigate(`/game/${game.slug}`)}
              onKeyDown={(e) => { if (e.key === "Enter") navigate(`/game/${game.slug}`); }}
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
                src={game.coverImageUrl || PLACEHOLDER_COVER}
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
