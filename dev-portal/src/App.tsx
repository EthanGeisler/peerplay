import { useEffect } from "react";
import { Routes, Route, useNavigate, useLocation, Link, Navigate } from "react-router-dom";
import { useAuthStore } from "./stores/authStore";
import { Login } from "./pages/Login";
import { SetupDeveloper } from "./pages/SetupDeveloper";
import { Dashboard } from "./pages/Dashboard";
import { GameEditor } from "./pages/GameEditor";
import { GameDetail } from "./pages/GameDetail";

const NAV_ITEMS = [
  { label: "Dashboard", path: "/" },
  { label: "Games", path: "/games" },
] as const;

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const developer = useAuthStore((s) => s.developer);
  const loading = useAuthStore((s) => s.loading);
  const logout = useAuthStore((s) => s.logout);
  const loadSession = useAuthStore((s) => s.loadSession);

  useEffect(() => {
    loadSession();
  }, []);

  // Loading state
  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          color: "var(--text-secondary)",
          fontSize: 16,
        }}
      >
        Loading...
      </div>
    );
  }

  // Not logged in — show login
  if (!user) {
    return <Login />;
  }

  // Logged in but not a developer — show setup
  if (!developer) {
    return <SetupDeveloper />;
  }

  // Full app
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          height: 56,
          backgroundColor: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border)",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <Link
            to="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              textDecoration: "none",
            }}
          >
            <span
              style={{
                fontSize: 20,
                fontWeight: 800,
                color: "var(--accent)",
                letterSpacing: 2,
              }}
            >
              BOILERDECK
            </span>
            <span
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 4,
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                fontWeight: 600,
                letterSpacing: 0.5,
              }}
            >
              DEV
            </span>
          </Link>

          <nav style={{ display: "flex", gap: 4 }}>
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.path === "/"
                  ? location.pathname === "/" || location.pathname === ""
                  : location.pathname.startsWith(item.path);
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "var(--radius)",
                    backgroundColor: isActive ? "var(--bg-tertiary)" : "transparent",
                    color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                    fontWeight: isActive ? 600 : 400,
                    fontSize: 14,
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>
              {developer.studioName}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{user.email ?? "Nostr User"}</div>
          </div>
          <button
            onClick={logout}
            style={{
              padding: "6px 14px",
              borderRadius: "var(--radius)",
              backgroundColor: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
              fontSize: 13,
            }}
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Content */}
      <main style={{ flex: 1, padding: "32px 24px", maxWidth: 1000, margin: "0 auto", width: "100%" }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/games/new" element={<GameEditor />} />
          <Route path="/games/:id" element={<GameDetail />} />
          <Route path="/games/:id/edit" element={<GameEditor />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer
        style={{
          padding: "16px 24px",
          borderTop: "1px solid var(--border)",
          textAlign: "center",
          fontSize: 12,
          color: "var(--text-muted)",
        }}
      >
        BoilerDeck Developer Portal v0.1.0 — 99/1 revenue split. Built with BitTorrent.
      </footer>
    </div>
  );
}
