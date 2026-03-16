import { useEffect } from "react";
import { Routes, Route, useNavigate, useLocation, Link } from "react-router-dom";
import { Store } from "./pages/Store";
import { GameDetail } from "./pages/GameDetail";
import { Library } from "./pages/Library";
import { About } from "./pages/About";
import { Login } from "./pages/Login";
import { CheckoutSuccess } from "./pages/CheckoutSuccess";
import { CheckoutCancel } from "./pages/CheckoutCancel";
import { useAuthStore } from "./stores/authStore";

const NAV_ITEMS = [
  { label: "Store", path: "/" },
  { label: "Library", path: "/library" },
  { label: "About", path: "/about" },
] as const;

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const logout = useAuthStore((s) => s.logout);
  const loadSession = useAuthStore((s) => s.loadSession);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <span style={{ color: "var(--text-secondary)" }}>Loading...</span>
      </div>
    );
  }

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
              fontSize: 20,
              fontWeight: 800,
              color: "var(--accent)",
              letterSpacing: 2,
              textDecoration: "none",
            }}
          >
            BOILERDECK
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
                    if (!isActive)
                      e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive)
                      e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a
            href="https://github.com/EthanGeisler/peerplay/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: "var(--radius)",
              backgroundColor: "var(--accent-green)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z"/>
              <path d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.969a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.78a.749.749 0 1 1 1.06-1.06l1.97 1.969Z"/>
            </svg>
            <span className="download-label">Download for Windows</span>
          </a>
          <a
            href="/dev/"
            style={{
              padding: "6px 14px",
              borderRadius: "var(--radius)",
              backgroundColor: "transparent",
              color: "var(--text-secondary)",
              fontSize: 13,
              textDecoration: "none",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
          >
            Developer Portal
          </a>
          {user ? (
            <>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {user.displayName}
              </span>
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
            </>
          ) : (
            <button
              onClick={() => navigate("/login")}
              style={{
                padding: "6px 14px",
                borderRadius: "var(--radius)",
                backgroundColor: "var(--accent)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      {/* Content */}
      <main style={{ flex: 1, padding: "32px 24px", maxWidth: 1200, margin: "0 auto", width: "100%" }}>
        <Routes>
          <Route path="/" element={<Store />} />
          <Route path="/game/:slug" element={<GameDetail />} />
          <Route path="/library" element={<Library />} />
          <Route path="/about" element={<About />} />
          <Route path="/login" element={<Login />} />
          <Route path="/checkout/success" element={<CheckoutSuccess />} />
          <Route path="/checkout/cancel" element={<CheckoutCancel />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer
        style={{
          padding: "24px",
          borderTop: "1px solid var(--border)",
          textAlign: "center",
          fontSize: 13,
          color: "var(--text-muted)",
        }}
      >
        BoilerDeck v0.1.0 — Decentralized game distribution. 99/1 revenue split.
        Built with BitTorrent.
      </footer>
    </div>
  );
}
