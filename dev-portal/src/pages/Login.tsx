import { useState } from "react";
import { useAuthStore } from "../stores/authStore";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const loading = useAuthStore((s) => s.loading);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await login(email, password);
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
            BOILERDECK
          </div>
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            Developer Portal
          </div>
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
            {loading ? "..." : "Sign In"}
          </button>
        </form>

        <div
          style={{
            marginTop: 24,
            textAlign: "center",
            fontSize: 13,
            color: "var(--text-muted)",
          }}
        >
          Don't have an account?{" "}
          <a
            href="/#/login"
            style={{ color: "var(--accent)", textDecoration: "underline" }}
          >
            Register on the storefront
          </a>
        </div>
      </div>
    </div>
  );
}
