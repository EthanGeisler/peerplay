import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { MnemonicModal } from "../components/MnemonicModal";

export function Login() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const registerWithNostr = useAuthStore((s) => s.registerWithNostr);
  const registerWithExistingNostr = useAuthStore((s) => s.registerWithExistingNostr);
  const loginWithNostr = useAuthStore((s) => s.loginWithNostr);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [useNostr, setUseNostr] = useState(false);
  const [hasExistingKey, setHasExistingKey] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (tab === "login") {
        if (useNostr) {
          await loginWithNostr(recoveryPhrase);
          navigate("/");
        } else {
          const m = await login(email, password);
          if (m) {
            setMnemonic(m);
          } else {
            navigate("/");
          }
        }
      } else {
        if (useNostr && hasExistingKey) {
          await registerWithExistingNostr(displayName, recoveryPhrase);
          navigate("/");
        } else if (useNostr) {
          const m = await registerWithNostr(displayName);
          setMnemonic(m);
        } else {
          const m = await register(email, password, displayName);
          if (m) {
            setMnemonic(m);
          } else {
            navigate("/");
          }
        }
      }
    } catch {
      // Error is set in the store
    } finally {
      setSubmitting(false);
    }
  };

  const handleTabSwitch = (t: "login" | "register") => {
    setTab(t);
    setUseNostr(false);
    setHasExistingKey(false);
    clearError();
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
            onClick={() => handleTabSwitch(t)}
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
        {!useNostr ? (
          <>
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
          </>
        ) : (
          <>
            {tab === "register" ? (
              <div style={{ marginBottom: 24 }}>
                <label htmlFor="nostrDisplayName" style={labelStyle}>Display Name</label>
                <input
                  id="nostrDisplayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  style={inputStyle}
                  placeholder="Your name"
                />
                {hasExistingKey ? (
                  <>
                    <div style={{ marginTop: 16 }}>
                      <label htmlFor="existingPhrase" style={labelStyle}>Recovery Phrase</label>
                      <textarea
                        id="existingPhrase"
                        value={recoveryPhrase}
                        onChange={(e) => setRecoveryPhrase(e.target.value)}
                        required
                        style={{ ...inputStyle, minHeight: 80, resize: "vertical", fontFamily: "monospace" }}
                        placeholder="Enter your 12-word recovery phrase"
                      />
                    </div>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.4 }}>
                      Enter the 12-word recovery phrase from your existing Nostr identity.
                    </p>
                    <button
                      type="button"
                      onClick={() => { setHasExistingKey(false); setRecoveryPhrase(""); clearError(); }}
                      style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 12, cursor: "pointer", padding: "4px 0", marginTop: 4 }}
                    >
                      Generate a new key instead
                    </button>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.4 }}>
                      A keypair will be generated in your browser. You'll receive a 12-word recovery phrase — this is your only way to sign in.
                    </p>
                    <button
                      type="button"
                      onClick={() => { setHasExistingKey(true); clearError(); }}
                      style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 12, cursor: "pointer", padding: "4px 0", marginTop: 4 }}
                    >
                      I already have a Nostr key
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div style={{ marginBottom: 24 }}>
                <label htmlFor="recoveryPhrase" style={labelStyle}>Recovery Phrase</label>
                <textarea
                  id="recoveryPhrase"
                  value={recoveryPhrase}
                  onChange={(e) => setRecoveryPhrase(e.target.value)}
                  required
                  style={{ ...inputStyle, minHeight: 80, resize: "vertical", fontFamily: "monospace" }}
                  placeholder="Enter your 12-word recovery phrase"
                />
              </div>
            )}
          </>
        )}

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
          {submitting
            ? "..."
            : useNostr
              ? tab === "login"
                ? "Sign In with Key"
                : hasExistingKey
                  ? "Link Nostr Account"
                  : "Create Nostr Account"
              : tab === "login"
                ? "Sign In"
                : "Create Account"}
        </button>
      </form>

      {/* Nostr toggle */}
      <div style={{ marginTop: 20, textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1, height: 1, backgroundColor: "var(--border)" }} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>or</span>
          <div style={{ flex: 1, height: 1, backgroundColor: "var(--border)" }} />
        </div>
        <button
          type="button"
          onClick={() => { setUseNostr(!useNostr); setHasExistingKey(false); setRecoveryPhrase(""); clearError(); }}
          style={{
            background: "none",
            border: "none",
            color: "var(--accent)",
            fontSize: 13,
            cursor: "pointer",
            padding: "4px 0",
          }}
        >
          {useNostr
            ? "Use email instead"
            : tab === "login"
              ? "Use Nostr key instead"
              : "Register with Nostr key instead"}
        </button>
      </div>

      {mnemonic && (
        <MnemonicModal
          mnemonic={mnemonic}
          onClose={() => {
            setMnemonic(null);
            navigate("/");
          }}
          nostrOnly={useNostr}
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
