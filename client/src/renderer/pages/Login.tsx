import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { MnemonicModal } from "../components/MnemonicModal";

const styles = {
  container: {
    maxWidth: 400,
    margin: "60px auto",
  } as React.CSSProperties,
  heading: {
    fontSize: 28,
    fontWeight: 700,
    color: "#ffffff",
    marginBottom: 24,
    textAlign: "center",
  } as React.CSSProperties,
  tabs: {
    display: "flex",
    gap: 0,
    marginBottom: 24,
  } as React.CSSProperties,
  tab: (active: boolean) =>
    ({
      flex: 1,
      padding: "10px 0",
      textAlign: "center",
      cursor: "pointer",
      fontSize: 14,
      fontWeight: active ? 600 : 400,
      color: active ? "#e94560" : "#888",
      borderBottom: active ? "2px solid #e94560" : "2px solid #0f3460",
      transition: "color 0.15s, border-color 0.15s",
    }) as React.CSSProperties,
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } as React.CSSProperties,
  label: {
    fontSize: 13,
    color: "#aaa",
    marginBottom: 4,
    display: "block",
  } as React.CSSProperties,
  input: {
    width: "100%",
    padding: "10px 12px",
    fontSize: 14,
    backgroundColor: "#16213e",
    border: "1px solid #0f3460",
    borderRadius: 4,
    color: "#e0e0e0",
    outline: "none",
  } as React.CSSProperties,
  button: {
    padding: "12px",
    fontSize: 15,
    fontWeight: 600,
    backgroundColor: "#e94560",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    marginTop: 8,
  } as React.CSSProperties,
  error: {
    color: "#e94560",
    fontSize: 13,
    textAlign: "center",
  } as React.CSSProperties,
  toggle: {
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
    marginTop: 4,
  } as React.CSSProperties,
  toggleLabel: {
    fontSize: 12,
    color: "#888",
    marginLeft: 8,
  } as React.CSSProperties,
};

export function Login() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const registerSelfCustody = useAuthStore((s) => s.registerSelfCustody);

  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [selfCustody, setSelfCustody] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      let m: string | undefined;
      if (tab === "login") {
        m = await login(email, password);
      } else if (selfCustody) {
        m = await registerSelfCustody(email, password, displayName);
      } else {
        m = await register(email, password, displayName);
      }
      if (m) {
        setMnemonic(m);
      } else {
        navigate("/");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>Welcome to BoilerDeck</h1>
      <div style={styles.tabs}>
        <div style={styles.tab(tab === "login")} onClick={() => setTab("login")}>
          Sign In
        </div>
        <div style={styles.tab(tab === "register")} onClick={() => setTab("register")}>
          Create Account
        </div>
      </div>
      <form style={styles.form} onSubmit={handleSubmit}>
        {tab === "register" && (
          <div>
            <label style={styles.label} htmlFor="displayName">
              Display Name
            </label>
            <input
              id="displayName"
              style={styles.input}
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>
        )}
        <div>
          <label style={styles.label} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            style={styles.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label style={styles.label} htmlFor="password">
            Password
          </label>
          <input
            id="password"
            style={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </div>
        {tab === "register" && (
          <label style={styles.toggle}>
            <input
              type="checkbox"
              checked={selfCustody}
              onChange={(e) => setSelfCustody(e.target.checked)}
              style={{ accentColor: "#e94560" }}
            />
            <span style={styles.toggleLabel}>
              Generate keys on this device (advanced)
            </span>
          </label>
        )}
        {error && <p style={styles.error}>{error}</p>}
        <button style={styles.button} type="submit" disabled={submitting}>
          {submitting ? "Please wait..." : tab === "login" ? "Sign In" : "Create Account"}
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
