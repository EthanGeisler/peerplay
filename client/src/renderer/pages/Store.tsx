import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGameStore } from "../stores/gameStore";
import { formatPrice, PLACEHOLDER_COVER, resolveCoverUrl } from "../utils";
import type { ContentType } from "../types";

const styles = {
  heading: {
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 24,
    color: "#ffffff",
  } as React.CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: 20,
  } as React.CSSProperties,
  card: {
    backgroundColor: "#16213e",
    borderRadius: 8,
    overflow: "hidden",
    border: "1px solid #0f3460",
    cursor: "pointer",
    transition: "border-color 0.15s, transform 0.15s",
  } as React.CSSProperties,
  cardImg: {
    width: "100%",
    height: 140,
    objectFit: "cover",
    display: "block",
  } as React.CSSProperties,
  cardBody: {
    padding: "12px 14px",
  } as React.CSSProperties,
  cardTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: "#fff",
    marginBottom: 4,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } as React.CSSProperties,
  cardStudio: {
    fontSize: 12,
    color: "#888",
    marginBottom: 8,
  } as React.CSSProperties,
  cardFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  } as React.CSSProperties,
  cardPrice: {
    fontSize: 14,
    fontWeight: 700,
    color: "#e94560",
  } as React.CSSProperties,
  loading: {
    color: "#888",
    fontSize: 16,
    marginTop: 40,
    textAlign: "center",
  } as React.CSSProperties,
};

const TABS: { label: string; value: ContentType | undefined }[] = [
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
  const sovereignMode = useGameStore((s) => s.sovereignMode);
  const [activeFilter, setActiveFilter] = useState<ContentType | undefined>(undefined);

  useEffect(() => {
    fetchGames(1, activeFilter);
  }, [fetchGames, activeFilter]);

  if (loading && games.length === 0) {
    return <p style={styles.loading}>Loading games...</p>;
  }

  return (
    <div>
      <h1 style={styles.heading}>Store</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {TABS.map((tab) => (
          <button
            key={tab.label}
            onClick={() => setActiveFilter(tab.value)}
            style={{
              padding: "6px 16px",
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 600,
              border: "1px solid",
              cursor: "pointer",
              borderColor: activeFilter === tab.value ? "#e94560" : "#0f3460",
              backgroundColor: activeFilter === tab.value ? "#e94560" : "#16213e",
              color: activeFilter === tab.value ? "#fff" : "#888",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {games.length === 0 ? (
        <p style={styles.loading}>No games available yet.</p>
      ) : (
        <div style={styles.grid}>
          {games.map((game) => (
            <div
              key={game.id}
              style={styles.card}
              onClick={() => navigate(`/game/${game.slug}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") navigate(`/game/${game.slug}`);
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#e94560";
                e.currentTarget.style.transform = "translateY(-2px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#0f3460";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              <img
                style={styles.cardImg}
                src={resolveCoverUrl(game.coverImageUrl)}
                alt={game.title}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = PLACEHOLDER_COVER;
                }}
              />
              <div style={styles.cardBody}>
                <div style={styles.cardTitle}>{game.title}</div>
                <div style={styles.cardStudio}>{game.studioName}</div>
                {sovereignMode && game.relaySource && (
                  <div
                    style={{
                      display: "inline-block",
                      backgroundColor: "#0f3460",
                      color: "#888",
                      fontSize: 10,
                      padding: "2px 8px",
                      borderRadius: 10,
                      marginBottom: 6,
                      maxWidth: "100%",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {(() => {
                      try {
                        return new URL(game.relaySource).hostname;
                      } catch {
                        return game.relaySource;
                      }
                    })()}
                  </div>
                )}
                <div style={styles.cardFooter}>
                  <span style={styles.cardPrice}>{formatPrice(game.priceCents)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
