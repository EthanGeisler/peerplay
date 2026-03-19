import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useGameStore } from "../stores/gameStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useAuthStore } from "../stores/authStore";
import { formatPrice, PLACEHOLDER_COVER } from "../utils";
import type { ContentType } from "../types";

const CONTENT_TABS: { label: string; value: ContentType | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Games", value: "GAME" },
  { label: "Videos", value: "VIDEO" },
  { label: "Software", value: "SOFTWARE" },
  { label: "Audio", value: "AUDIO" },
];

export function Store() {
  const navigate = useNavigate();
  const games = useGameStore((s) => s.games);
  const loading = useGameStore((s) => s.loading);
  const fetchGames = useGameStore((s) => s.fetchGames);
  const licenses = useLibraryStore((s) => s.licenses);
  const fetchLicenses = useLibraryStore((s) => s.fetchLicenses);
  const user = useAuthStore((s) => s.user);

  const [searchQuery, setSearchQuery] = useState("");
  const [contentFilter, setContentFilter] = useState<ContentType | undefined>(undefined);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    fetchGames(undefined, contentFilter);
  }, [fetchGames, contentFilter]);

  const handleSearch = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchGames(value || undefined, contentFilter);
      }, 300);
    },
    [fetchGames, contentFilter],
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

      {/* Download CTA */}
      {!isSearching && (
        <a
          href="/downloads/BoilerDeck%20Setup%200.5.2.exe"
          download
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 16,
            padding: "16px 24px",
            marginBottom: 24,
            borderRadius: "var(--radius-lg)",
            border: "1px solid rgba(63,185,80,0.3)",
            background: "linear-gradient(135deg, rgba(63,185,80,0.08) 0%, rgba(88,166,255,0.06) 100%)",
            textDecoration: "none",
            transition: "border-color 0.15s, background 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--accent-green)";
            e.currentTarget.style.background =
              "linear-gradient(135deg, rgba(63,185,80,0.14) 0%, rgba(88,166,255,0.1) 100%)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "rgba(63,185,80,0.3)";
            e.currentTarget.style.background =
              "linear-gradient(135deg, rgba(63,185,80,0.08) 0%, rgba(88,166,255,0.06) 100%)";
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
              Get the BoilerDeck Desktop Client
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              Download games via BitTorrent. Available for Windows and Linux.
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 20px",
              borderRadius: "var(--radius)",
              backgroundColor: "var(--accent-green)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z"/>
              <path d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.969a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.78a.749.749 0 1 1 1.06-1.06l1.97 1.969Z"/>
            </svg>
            Download for Windows
          </div>
        </a>
      )}

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
          <span style={tagStyle("#d29922", "rgba(210,153,34,0.15)")}>DRM-Free Distribution</span>
        </div>
      )}

      {/* Content type filter tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {CONTENT_TABS.map((tab) => (
          <button
            key={tab.label}
            onClick={() => setContentFilter(tab.value)}
            style={{
              padding: "6px 16px",
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 600,
              border: "1px solid",
              cursor: "pointer",
              borderColor: contentFilter === tab.value ? "var(--accent)" : "var(--border)",
              backgroundColor: contentFilter === tab.value ? "var(--accent)" : "transparent",
              color: contentFilter === tab.value ? "#fff" : "var(--text-secondary)",
              transition: "all 0.15s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Listing grid */}
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, color: "var(--text-primary)" }}>
        {isSearching ? `Results for "${searchQuery}"` : contentFilter ? `Browse ${contentFilter.charAt(0) + contentFilter.slice(1).toLowerCase()}s` : "Browse All"}
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
