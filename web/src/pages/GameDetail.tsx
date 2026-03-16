import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAppStore } from "../stores/appStore";
import type { GameEdition } from "../data/mock";

function formatPrice(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

function drmDescription(tier: string): string {
  switch (tier) {
    case "NONE":
      return "DRM-Free \u2014 play anytime, online or offline";
    case "LIGHT":
      return "Online license check at launch \u2014 internet required to start, play offline after";
    case "ENCRYPTED":
      return "Encrypted distribution \u2014 files decrypted locally after purchase via Peerplay client";
    default:
      return tier;
  }
}

export function GameDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const getGame = useAppStore((s) => s.getGame);
  const isOwned = useAppStore((s) => s.isOwned);
  const purchase = useAppStore((s) => s.purchase);
  const user = useAppStore((s) => s.user);
  const login = useAppStore((s) => s.login);

  const game = getGame(slug ?? "");
  const [selectedEditionId, setSelectedEditionId] = useState<string | undefined>(
    game?.editions?.[0]?.id,
  );

  if (!game) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0" }}>
        <h2 style={{ fontSize: 24, marginBottom: 12 }}>Game not found</h2>
        <button
          onClick={() => navigate("/")}
          style={{
            padding: "8px 20px",
            borderRadius: "var(--radius)",
            backgroundColor: "var(--accent)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Back to Store
        </button>
      </div>
    );
  }

  const owned = isOwned(game.id);
  const hasEditions = game.editions && game.editions.length > 1;
  const selectedEdition: GameEdition | undefined = hasEditions
    ? game.editions!.find((e) => e.id === selectedEditionId) ?? game.editions![0]
    : undefined;

  // Use selected edition's values if available, otherwise fall back to game-level
  const displayPrice = selectedEdition ? selectedEdition.priceCents : game.priceCents;
  const displayDrmTier = selectedEdition ? selectedEdition.drmTier : game.drmTier;
  const devShare = displayPrice - Math.ceil(displayPrice / 100);

  return (
    <div>
      <button
        onClick={() => navigate("/")}
        style={{
          padding: "6px 14px",
          borderRadius: "var(--radius)",
          backgroundColor: "var(--bg-tertiary)",
          color: "var(--text-secondary)",
          fontSize: 13,
          marginBottom: 24,
        }}
      >
        &larr; Back to Store
      </button>

      {/* Hero */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gap: 24,
          marginBottom: 32,
        }}
      >
        <div>
          <img
            src={game.coverImageUrl}
            alt={game.title}
            style={{
              width: "100%",
              height: 320,
              objectFit: "cover",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border)",
            }}
          />
          {game.screenshots.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, overflowX: "auto" }}>
              {game.screenshots.map((ss, i) => (
                <img
                  key={i}
                  src={ss}
                  alt={`Screenshot ${i + 1}`}
                  style={{
                    width: 200,
                    height: 112,
                    objectFit: "cover",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--border)",
                    flexShrink: 0,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border)",
            padding: 24,
            alignSelf: "start",
          }}
        >
          <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>{game.title}</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
            by {game.studioName}
          </p>

          {/* Edition picker */}
          {hasEditions && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, fontWeight: 600 }}>
                Choose Edition
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {game.editions!.map((edition) => {
                  const isSelected = edition.id === (selectedEdition?.id ?? game.editions![0].id);
                  return (
                    <button
                      key={edition.id}
                      onClick={() => setSelectedEditionId(edition.id)}
                      style={{
                        flex: 1,
                        padding: "10px 8px",
                        borderRadius: "var(--radius)",
                        backgroundColor: isSelected ? "var(--bg-tertiary)" : "transparent",
                        border: isSelected
                          ? "2px solid var(--accent)"
                          : "1px solid var(--border)",
                        color: isSelected ? "var(--text-primary)" : "var(--text-secondary)",
                        fontSize: 12,
                        fontWeight: isSelected ? 700 : 500,
                        cursor: "pointer",
                        textAlign: "center",
                        transition: "all 0.15s",
                      }}
                    >
                      <div>{edition.label}</div>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 800,
                          marginTop: 4,
                          color: edition.priceCents === 0 ? "var(--accent-green)" : "var(--text-primary)",
                        }}
                      >
                        {formatPrice(edition.priceCents)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div
            style={{
              fontSize: hasEditions ? 20 : 28,
              fontWeight: 800,
              marginBottom: 16,
              color: displayPrice === 0 ? "var(--accent-green)" : "var(--text-primary)",
            }}
          >
            {hasEditions ? (selectedEdition?.label ?? "") : formatPrice(displayPrice)}
            {!hasEditions ? "" : ` \u2014 ${formatPrice(displayPrice)}`}
          </div>

          {owned ? (
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  padding: "12px 0",
                  textAlign: "center",
                  borderRadius: "var(--radius)",
                  backgroundColor: "rgba(63,185,80,0.15)",
                  color: "var(--accent-green)",
                  fontWeight: 700,
                  fontSize: 14,
                  marginBottom: 8,
                }}
              >
                In Your Library
              </div>
              {game.magnetUri && (
                <a
                  href={game.magnetUri}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "12px 0",
                    borderRadius: "var(--radius)",
                    backgroundColor: "var(--accent-blue)",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 14,
                    textAlign: "center",
                    textDecoration: "none",
                    marginBottom: 8,
                  }}
                >
                  Download via Torrent ({game.fileSizeMB}MB)
                </a>
              )}
              {game.magnetUri && (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    backgroundColor: "var(--bg-primary)",
                    padding: 8,
                    borderRadius: "var(--radius)",
                    wordBreak: "break-all",
                    fontFamily: "monospace",
                  }}
                >
                  {game.magnetUri}
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => {
                if (!user) login("player@peerplay.io");
                purchase(game.id, selectedEdition?.id);
              }}
              style={{
                width: "100%",
                padding: "12px 0",
                borderRadius: "var(--radius)",
                backgroundColor: "var(--accent)",
                color: "#fff",
                fontWeight: 700,
                fontSize: 14,
                marginBottom: 16,
                transition: "background-color 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--accent-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--accent)")}
            >
              {displayPrice === 0 ? "Get for Free" : `Buy Now \u2014 ${formatPrice(displayPrice)}`}
            </button>
          )}

          {/* DRM info */}
          <div
            style={{
              backgroundColor: "var(--bg-tertiary)",
              borderRadius: "var(--radius)",
              padding: 12,
              marginBottom: 16,
              borderLeft: `3px solid ${
                displayDrmTier === "NONE"
                  ? "var(--accent-green)"
                  : displayDrmTier === "LIGHT"
                    ? "#d29922"
                    : "var(--accent-blue)"
              }`,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                marginBottom: 4,
                color:
                  displayDrmTier === "NONE"
                    ? "var(--accent-green)"
                    : displayDrmTier === "LIGHT"
                      ? "#d29922"
                      : "var(--accent-blue)",
              }}
            >
              {displayDrmTier === "NONE"
                ? "DRM-Free"
                : displayDrmTier === "LIGHT"
                  ? "Online Check"
                  : "Encrypted"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {drmDescription(displayDrmTier)}
            </div>
          </div>

          {/* Revenue breakdown */}
          {displayPrice > 0 && (
            <div
              style={{
                backgroundColor: "var(--bg-tertiary)",
                borderRadius: "var(--radius)",
                padding: 12,
                marginBottom: 16,
                fontSize: 12,
              }}
            >
              <div style={{ color: "var(--text-muted)", marginBottom: 8, fontWeight: 600 }}>
                Revenue Split
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ color: "var(--accent-green)" }}>Developer (99%)</span>
                <span style={{ color: "var(--accent-green)" }}>${(devShare / 100).toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Platform (1%)</span>
                <span style={{ color: "var(--text-muted)" }}>
                  ${(Math.ceil(displayPrice / 100) / 100).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Tags */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {game.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  backgroundColor: "var(--bg-primary)",
                  padding: "4px 10px",
                  borderRadius: 4,
                }}
              >
                {tag}
              </span>
            ))}
          </div>

          {/* Meta */}
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 2 }}>
            <div>
              Distribution:{" "}
              <span style={{ color: "var(--text-secondary)" }}>BitTorrent (P2P)</span>
            </div>
            <div>
              Released:{" "}
              <span style={{ color: "var(--text-secondary)" }}>{game.releaseDate}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Description */}
      <div
        style={{
          backgroundColor: "var(--bg-secondary)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
          padding: 24,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>About This Game</h2>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.8 }}>
          {game.description}
        </p>
      </div>
    </div>
  );
}
