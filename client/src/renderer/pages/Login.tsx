import { useState, useEffect } from "react";
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
  divider: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: "16px 0",
  } as React.CSSProperties,
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#0f3460",
  } as React.CSSProperties,
  dividerText: {
    fontSize: 12,
    color: "#888",
  } as React.CSSProperties,
  nostrToggleBtn: {
    background: "none",
    border: "none",
    color: "#e94560",
    fontSize: 13,
    cursor: "pointer",
    padding: "4px 0",
  } as React.CSSProperties,
  cachedKeyBtn: {
    width: "100%",
    padding: "12px",
    fontSize: 14,
    fontWeight: 600,
    backgroundColor: "#0f3460",
    color: "#e0e0e0",
    border: "1px solid #e94560",
    borderRadius: 4,
    cursor: "pointer",
    marginBottom: 12,
  } as React.CSSProperties,
  helpText: {
    fontSize: 12,
    color: "#888",
    marginTop: 8,
    lineHeight: 1.4,
  } as React.CSSProperties,
};

export function Login() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const registerSelfCustody = useAuthStore((s) => s.registerSelfCustody);
  const registerWithNostr = useAuthStore((s) => s.registerWithNostr);
  const loginWithPubkey = useAuthStore((s) => s.loginWithPubkey);
  const loginWithMnemonic = useAuthStore((s) => s.loginWithMnemonic);

  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [selfCustody, setSelfCustody] = useState(false);
  const [useNostr, setUseNostr] = useState(false);
  const [hasCachedKey, setHasCachedKey] = useState(false);

  // Check if there's a cached self-custody key for one-click sign-in
  useEffect(() => {
    window.boilerdeck.store.get("selfCustodyKey").then((val) => {
      setHasCachedKey(!!val);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      let m: string | undefined;
      if (tab === "login") {
        if (useNostr) {
          await loginWithMnemonic(recoveryPhrase);
          navigate("/");
          return;
        }
        m = await login(email, password);
      } else if (useNostr) {
        m = await registerWithNostr(displayName);
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

  const handleCachedKeyLogin = async () => {
    setError("");
    setSubmitting(true);
    try {
      await loginWithPubkey();
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleTabSwitch = (t: "login" | "register") => {
    setTab(t);
    setUseNostr(false);
    setError("");
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>Welcome to BoilerDeck</h1>
      <div style={styles.tabs}>
        <div style={styles.tab(tab === "login")} onClick={() => handleTabSwitch("login")}>
          Sign In
        </div>
        <div style={styles.tab(tab === "register")} onClick={() => handleTabSwitch("register")}>
          Create Account
        </div>
      </div>

      {/* One-click cached key login */}
      {tab === "login" && hasCachedKey && !useNostr && (
        <button
          style={styles.cachedKeyBtn}
          onClick={handleCachedKeyLogin}
          disabled={submitting}
        >
          Sign in with saved key
        </button>
      )}

      <form style={styles.form} onSubmit={handleSubmit}>
        {!useNostr ? (
          <>
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
          </>
        ) : (
          <>
            {tab === "register" ? (
              <div>
                <label style={styles.label} htmlFor="nostrDisplayName">
                  Display Name
                </label>
                <input
                  id="nostrDisplayName"
                  style={styles.input}
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
                <p style={styles.helpText}>
                  A keypair will be generated on this device. You'll receive a 12-word recovery phrase — this is your only way to sign in.
                </p>
              </div>
            ) : (
              <div>
                <label style={styles.label} htmlFor="recoveryPhrase">
                  Recovery Phrase
                </label>
                <textarea
                  id="recoveryPhrase"
                  value={recoveryPhrase}
                  onChange={(e) => setRecoveryPhrase(e.target.value)}
                  required
                  style={{
                    ...styles.input,
                    minHeight: 80,
                    resize: "vertical",
                    fontFamily: "monospace",
                  }}
                  placeholder="Enter your 12-word recovery phrase"
                />
              </div>
            )}
          </>
        )}

        {error && <p style={styles.error}>{error}</p>}
        <button style={styles.button} type="submit" disabled={submitting}>
          {submitting
            ? "Please wait..."
            : useNostr
              ? tab === "login"
                ? "Sign In with Key"
                : "Create Nostr Account"
              : tab === "login"
                ? "Sign In"
                : "Create Account"}
        </button>
      </form>

      {/* Nostr toggle */}
      <div style={styles.divider}>
        <div style={styles.dividerLine} />
        <span style={styles.dividerText}>or</span>
        <div style={styles.dividerLine} />
      </div>
      <div style={{ textAlign: "center" }}>
        <button
          type="button"
          onClick={() => { setUseNostr(!useNostr); setError(""); }}
          style={styles.nostrToggleBtn}
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
