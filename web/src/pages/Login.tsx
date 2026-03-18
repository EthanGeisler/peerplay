import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { MnemonicModal } from "../components/MnemonicModal";

export function Login() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mnemonic, setMnemonic] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (tab === "login") {
        await login(email, password);
        navigate("/");
      } else {
        const m = await register(email, password, displayName);
        if (m) {
          setMnemonic(m);
        } else {
          navigate("/");
        }
      }
    } catch {
      // Error is set in the store
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: "60px auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 24, textAlign: "center" }}>
        {tab === "login" ? "Sign In" : "Create Account"}
      </h1>

      {/* Tabs */}
      <div style={{ display: "flex", marginBottom: 24, gap: 4 }}>
        {(["login", "register"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); clearError(); }}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: "var(--radius)",
              backgroundColor: tab === t ? "var(--bg-tertiary)" : "transparent",
              color: tab === t ? "var(--text-primary)" : "var(--text-secondary)",
              fontWeight: tab === t ? 700 : 400,
              fontSize: 14,
              border: tab === t ? "1px solid var(--border)" : "1px solid transparent",
            }}
          >
            {t === "login" ? "Sign In" : "Register"}
          </button>
        ))}
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "var(--radius)",
            backgroundColor: "rgba(233,69,96,0.15)",
            color: "#e94560",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {tab === "register" && (
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="displayName" style={labelStyle}>Display Name</label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              style={inputStyle}
              placeholder="Your name"
            />
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="email" style={labelStyle}>Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
            placeholder="you@example.com"
          />
        </div>
        <div style={{ marginBottom: 24 }}>
          <label htmlFor="password" style={labelStyle}>Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            style={inputStyle}
            placeholder="At least 6 characters"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          style={{
            width: "100%",
            padding: "12px 0",
            borderRadius: "var(--radius)",
            backgroundColor: submitting ? "var(--bg-tertiary)" : "var(--accent)",
            color: "#fff",
            fontWeight: 700,
            fontSize: 14,
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? "..." : tab === "login" ? "Sign In" : "Create Account"}
        </button>
      </form>

      {mnemonic && (
        <MnemonicModal
          mnemonic={mnemonic}
          onClose={() => {
            setMnemonic(null);
            navigate("/");
          }}
        />
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-muted)",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "var(--radius)",
  backgroundColor: "var(--bg-tertiary)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  fontSize: 14,
  boxSizing: "border-box",
};
