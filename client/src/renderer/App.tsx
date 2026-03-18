import { useEffect } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { Store } from "./pages/Store";
import { Library } from "./pages/Library";
import { Downloads } from "./pages/Downloads";
import { Settings } from "./pages/Settings";
import { Login } from "./pages/Login";
import { GameDetail } from "./pages/GameDetail";
import { useAuthStore } from "./stores/authStore";
import { UpdateBanner } from "./components/UpdateBanner";
import { Profile } from "./pages/Profile";
import { SetupDeveloper, DevDashboard, DevGameDetail, DevGameEditor } from "./pages/developer";

const NAV_ITEMS = [
  { label: "Store", path: "/" },
  { label: "Library", path: "/library" },
  { label: "Downloads", path: "/downloads" },
  { label: "Settings", path: "/settings" },
] as const;

const styles = {
  container: {
    display: "flex",
    flex: 1,
    minHeight: 0,
    backgroundColor: "#1a1a2e",
    color: "#e0e0e0",
  } as React.CSSProperties,
  sidebar: {
    width: 220,
    backgroundColor: "#16213e",
    padding: "20px 0",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    flexShrink: 0,
  } as React.CSSProperties,
  logo: {
    fontSize: 22,
    fontWeight: 700,
    color: "#e94560",
    padding: "0 20px 20px",
    letterSpacing: 1,
  } as React.CSSProperties,
  navItem: (active: boolean) =>
    ({
      padding: "12px 20px",
      cursor: "pointer",
      backgroundColor: active ? "#0f3460" : "transparent",
      borderLeft: active ? "3px solid #e94560" : "3px solid transparent",
      fontSize: 14,
      fontWeight: active ? 600 : 400,
      transition: "background-color 0.15s, border-color 0.15s",
      userSelect: "none",
    }) as React.CSSProperties,
  content: {
    flex: 1,
    padding: 32,
    overflowY: "auto",
  } as React.CSSProperties,
  userSection: {
    marginTop: "auto",
    padding: "16px 20px",
    borderTop: "1px solid #0f3460",
    fontSize: 13,
  } as React.CSSProperties,
  userName: {
    color: "#e0e0e0",
    fontWeight: 600,
    marginBottom: 4,
  } as React.CSSProperties,
  userEmail: {
    color: "#888",
    fontSize: 12,
  } as React.CSSProperties,
  signOutBtn: {
    marginTop: 8,
    background: "none",
    border: "none",
    color: "#e94560",
    cursor: "pointer",
    fontSize: 12,
    padding: 0,
  } as React.CSSProperties,
  signInBtn: {
    background: "none",
    border: "1px solid #e94560",
    color: "#e94560",
    cursor: "pointer",
    fontSize: 13,
    padding: "8px 16px",
    borderRadius: 4,
    width: "100%",
  } as React.CSSProperties,
};

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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <UpdateBanner />
      <div style={styles.container}>
      <div style={styles.sidebar}>
        <div style={styles.logo}>BOILERDECK</div>
        {NAV_ITEMS.map((item) => (
          <div
            key={item.path}
            style={styles.navItem(location.pathname === item.path)}
            onClick={() => navigate(item.path)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") navigate(item.path);
            }}
            onMouseEnter={(e) => {
              if (location.pathname !== item.path) {
                e.currentTarget.style.backgroundColor = "#0f3460aa";
              }
            }}
            onMouseLeave={(e) => {
              if (location.pathname !== item.path) {
                e.currentTarget.style.backgroundColor = "transparent";
              }
            }}
          >
            {item.label}
          </div>
        ))}

        {/* Developer section — visible to DEVELOPER/ADMIN users */}
        {user && (user.role === "DEVELOPER" || user.role === "ADMIN") && (
          <>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#888",
                padding: "16px 20px 8px",
                letterSpacing: 1,
                textTransform: "uppercase",
                borderTop: "1px solid #0f3460",
                marginTop: 8,
              }}
            >
              Developer
            </div>
            <div
              style={styles.navItem(location.pathname.startsWith("/developer"))}
              onClick={() => navigate("/developer")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") navigate("/developer");
              }}
              onMouseEnter={(e) => {
                if (!location.pathname.startsWith("/developer")) {
                  e.currentTarget.style.backgroundColor = "#0f3460aa";
                }
              }}
              onMouseLeave={(e) => {
                if (!location.pathname.startsWith("/developer")) {
                  e.currentTarget.style.backgroundColor = "transparent";
                }
              }}
            >
              Dashboard
            </div>
          </>
        )}

        {/* "Become a Developer" link for regular users */}
        {user && user.role === "USER" && (
          <div
            style={{
              ...styles.navItem(location.pathname === "/developer/setup"),
              fontSize: 12,
              color: "#e94560",
              borderTop: "1px solid #0f3460",
              marginTop: 8,
            }}
            onClick={() => navigate("/developer/setup")}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") navigate("/developer/setup");
            }}
          >
            Become a Developer
          </div>
        )}

        <div style={styles.userSection}>
          {loading ? (
            <span style={{ color: "#888" }}>Loading...</span>
          ) : user ? (
            <>
              <div
                style={{ ...styles.userName, cursor: "pointer" }}
                onClick={() => navigate(`/profile/${user.pubkey || user.nostrPubkey}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") navigate(`/profile/${user.pubkey || user.nostrPubkey}`); }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#e94560"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "#e0e0e0"; }}
              >{user.displayName}</div>
              <div style={styles.userEmail}>{user.email ?? "Nostr User"}</div>
              <button
                style={styles.signOutBtn}
                onClick={async () => {
                  await logout();
                  navigate("/");
                }}
              >
                Sign Out
              </button>
            </>
          ) : (
            <button
              style={styles.signInBtn}
              onClick={() => navigate("/login")}
            >
              Sign In
            </button>
          )}
        </div>
      </div>
      <div style={styles.content}>
        <Routes>
          <Route path="/" element={<Store />} />
          <Route path="/game/:slug" element={<GameDetail />} />
          <Route path="/library" element={<Library />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/login" element={<Login />} />
          <Route path="/developer/setup" element={<SetupDeveloper />} />
          <Route path="/developer" element={<DevDashboard />} />
          <Route path="/developer/games/new" element={<DevGameEditor />} />
          <Route path="/developer/games/:id" element={<DevGameDetail />} />
          <Route path="/developer/games/:id/edit" element={<DevGameEditor />} />
          <Route path="/profile/:pubkey" element={<Profile />} />
          <Route
            path="*"
            element={
              <div style={{ textAlign: "center", marginTop: 80 }}>
                <h1 style={{ fontSize: 28, marginBottom: 12 }}>Page not found</h1>
                <p style={{ color: "#888", marginBottom: 20 }}>
                  The page you're looking for doesn't exist.
                </p>
                <a
                  href="#/"
                  style={{ color: "#e94560", textDecoration: "underline" }}
                >
                  Back to Store
                </a>
              </div>
            }
          />
        </Routes>
      </div>
      </div>
    </div>
  );
}
