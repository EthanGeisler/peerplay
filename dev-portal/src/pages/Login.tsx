import { useState } from "react";
import { useAuthStore } from "../stores/authStore";

export function Login() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const error = useAuthStore((s) => s.error);
  const loading = useAuthStore((s) => s.loading);
  const clearError = useAuthStore((s) => s.clearError);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "login") {
      await login(email, password);
    } else {
      await register(email, password, displayName);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          backgroundColor: "var(--bg-secondary)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
          padding: 32,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: "var(--accent)",
              letterSpacing: 2,
              marginBottom: 8,
            }}
          >
            PEERPLAY
          </div>
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            Developer Portal
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 4,
            marginBottom: 24,
            backgroundColor: "var(--bg-tertiary)",
            borderRadius: "var(--radius)",
            padding: 4,
          }}
        >
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                clearError();
              }}
              style={{
                flex: 1,
                padding: "8px 16px",
                borderRadius: "var(--radius)",
                backgroundColor: mode === m ? "var(--bg-hover)" : "transparent",
                color: mode === m ? "var(--text-primary)" : "var(--text-secondary)",
                fontWeight: mode === m ? 600 : 400,
                fontSize: 13,
                transition: "all 0.15s",
              }}
            >
              {m === "login" ? "Sign In" : "Create Account"}
            </button>
          ))}
        </div>

        {error && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: "var(--radius)",
              backgroundColor: "rgba(233, 69, 96, 0.1)",
              border: "1px solid rgba(233, 69, 96, 0.3)",
              color: "var(--accent)",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {mode === "register" && (
            <div>
              <label
                style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}
              >
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                required
                style={{ width: "100%" }}
              />
            </div>
          )}

          <div>
            <label
              style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label
              style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}
            >
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              required
              minLength={8}
              style={{ width: "100%" }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: "12px 24px",
              borderRadius: "var(--radius)",
              backgroundColor: "var(--accent)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              opacity: loading ? 0.7 : 1,
              transition: "opacity 0.15s",
            }}
          >
            {loading ? "..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <div
          style={{
            marginTop: 24,
            padding: "12px 14px",
            borderRadius: "var(--radius)",
            backgroundColor: "var(--bg-tertiary)",
            fontSize: 12,
            color: "var(--text-muted)",
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: "var(--text-secondary)" }}>Demo credentials:</strong>
          <br />
          dev@example.com / developer123
        </div>
      </div>
    </div>
  );
}
