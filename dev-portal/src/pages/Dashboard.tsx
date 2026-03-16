import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { useAuthStore } from "../stores/authStore";

interface GameSummary {
  id: string;
  slug: string;
  title: string;
  status: string;
  priceCents: number;
  drmTier: string;
  coverImageUrl: string | null;
  versionsCount: number;
  licensesCount: number;
  salesCount: number;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "var(--text-muted)",
  PENDING_REVIEW: "var(--accent-yellow)",
  PUBLISHED: "var(--accent-green)",
  SUSPENDED: "var(--accent)",
};

const DRM_LABELS: Record<string, { label: string; color: string }> = {
  NONE: { label: "DRM-Free", color: "var(--accent-green)" },
  LIGHT: { label: "Online Check", color: "var(--accent-yellow)" },
  ENCRYPTED: { label: "Encrypted", color: "var(--accent-blue)" },
};

export function Dashboard() {
  const navigate = useNavigate();
  const developer = useAuthStore((s) => s.developer);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ games: GameSummary[] }>("/developer/games")
      .then((data) => setGames(data.games))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalSales = games.reduce((sum, g) => sum + g.salesCount, 0);
  const publishedCount = games.filter((g) => g.status === "PUBLISHED").length;
  const [stripeLoading, setStripeLoading] = useState(false);

  const handleStripeConnect = useCallback(async () => {
    setStripeLoading(true);
    try {
      const data = await apiFetch<{ url?: string; status?: string }>("/developer/stripe/onboard");
      if (data.url) {
        window.location.assign(data.url);
      } else {
        setStripeLoading(false);
      }
    } catch (err) {
      console.error("Stripe onboard failed:", err);
      setStripeLoading(false);
    }
  }, []);

  return (
    <div>
      {/* Stripe onboarding banner */}
      {developer && !developer.stripeOnboarded && (
        <div
          style={{
            padding: "16px 20px",
            borderRadius: "var(--radius-lg)",
            backgroundColor: "rgba(210, 153, 34, 0.1)",
            border: "1px solid rgba(210, 153, 34, 0.3)",
            marginBottom: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#d29922", marginBottom: 4 }}>
              Complete Stripe Setup
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              Connect your Stripe account to receive payments for your games. Required for publishing paid games.
            </div>
          </div>
          <button
            onClick={handleStripeConnect}
            disabled={stripeLoading}
            style={{
              padding: "10px 20px",
              borderRadius: "var(--radius)",
              backgroundColor: "#635bff",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: "nowrap",
              opacity: stripeLoading ? 0.7 : 1,
            }}
          >
            {stripeLoading ? "Loading..." : "Connect with Stripe"}
          </button>
        </div>
      )}

      {developer && developer.stripeOnboarded && !developer.stripePayoutsEnabled && (
        <div
          style={{
            padding: "16px 20px",
            borderRadius: "var(--radius-lg)",
            backgroundColor: "rgba(210, 153, 34, 0.08)",
            border: "1px solid rgba(210, 153, 34, 0.2)",
            marginBottom: 24,
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          Your Stripe account is connected but payouts are not yet enabled. Please complete verification in your Stripe dashboard.
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
            Dashboard
            {developer?.stripeOnboarded && developer?.stripePayoutsEnabled && (
              <span
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  borderRadius: 4,
                  backgroundColor: "rgba(63,185,80,0.15)",
                  color: "var(--accent-green)",
                  fontWeight: 600,
                  marginLeft: 12,
                  verticalAlign: "middle",
                }}
              >
                Stripe Connected
              </span>
            )}
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            {developer?.studioName ?? "Developer Portal"}
          </p>
        </div>
        <button
          onClick={() => navigate("/games/new")}
          style={{
            padding: "10px 20px",
            borderRadius: "var(--radius)",
            backgroundColor: "var(--accent)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          + New Game
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
        {[
          { label: "Total Games", value: games.length },
          { label: "Published", value: publishedCount },
          { label: "Total Sales", value: totalSales },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: 20,
            }}
          >
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>
              {stat.label}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Games list */}
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Your Games</h2>

      {loading ? (
        <div style={{ color: "var(--text-secondary)", padding: 40, textAlign: "center" }}>Loading...</div>
      ) : games.length === 0 ? (
        <div
          style={{
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 48,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 16, color: "var(--text-secondary)", marginBottom: 16 }}>
            No games yet. Create your first game to get started.
          </div>
          <button
            onClick={() => navigate("/games/new")}
            style={{
              padding: "10px 20px",
              borderRadius: "var(--radius)",
              backgroundColor: "var(--accent)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            + New Game
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {games.map((game) => (
            <div
              key={game.id}
              onClick={() => navigate(`/games/${game.id}`)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: 16,
                backgroundColor: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                cursor: "pointer",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--text-muted)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
            >
              {/* Cover image */}
              <div
                style={{
                  width: 80,
                  height: 40,
                  borderRadius: 6,
                  backgroundColor: "var(--bg-tertiary)",
                  backgroundImage: game.coverImageUrl ? `url(${game.coverImageUrl})` : undefined,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  flexShrink: 0,
                }}
              />

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{game.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                  {game.versionsCount} version{game.versionsCount !== 1 ? "s" : ""}
                  {" / "}
                  {game.salesCount} sale{game.salesCount !== 1 ? "s" : ""}
                </div>
              </div>

              {/* DRM badge */}
              <span
                style={{
                  fontSize: 11,
                  padding: "4px 8px",
                  borderRadius: 4,
                  backgroundColor: "rgba(255,255,255,0.05)",
                  color: DRM_LABELS[game.drmTier]?.color ?? "var(--text-secondary)",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {DRM_LABELS[game.drmTier]?.label ?? game.drmTier}
              </span>

              {/* Price */}
              <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", minWidth: 60, textAlign: "right" }}>
                {game.priceCents === 0 ? "Free" : `$${(game.priceCents / 100).toFixed(2)}`}
              </span>

              {/* Status badge */}
              <span
                style={{
                  fontSize: 11,
                  padding: "4px 10px",
                  borderRadius: 4,
                  backgroundColor: "rgba(255,255,255,0.05)",
                  color: STATUS_COLORS[game.status] ?? "var(--text-secondary)",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  whiteSpace: "nowrap",
                }}
              >
                {game.status.replace("_", " ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
