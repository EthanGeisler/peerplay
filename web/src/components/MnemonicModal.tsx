import { useState } from "react";

interface MnemonicModalProps {
  mnemonic: string;
  onClose: () => void;
  nostrOnly?: boolean;
}

export function MnemonicModal({ mnemonic, onClose, nostrOnly }: MnemonicModalProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSkipWarning, setShowSkipWarning] = useState(false);

  const words = mnemonic.split(" ");

  const handleCopy = async () => {
    await navigator.clipboard.writeText(mnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSkip = () => {
    if (!showSkipWarning) {
      setShowSkipWarning(true);
      return;
    }
    onClose();
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, color: "var(--text-primary)" }}>
          Save Your Recovery Phrase
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.5 }}>
          This 12-word phrase is the only way to recover your cryptographic identity.
          Write it down and store it somewhere safe. It will not be shown again.
        </p>

        <div style={gridStyle}>
          {words.map((word, i) => (
            <div key={i} style={wordStyle}>
              <span style={{ color: "var(--text-muted)", fontSize: 11, marginRight: 6, minWidth: 18, textAlign: "right" }}>
                {i + 1}.
              </span>
              <span style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: 14, fontFamily: "monospace" }}>
                {word}
              </span>
            </div>
          ))}
        </div>

        <button onClick={handleCopy} style={copyButtonStyle}>
          {copied ? "Copied!" : "Copy to Clipboard"}
        </button>

        <label style={checkboxLabelStyle}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            style={{ marginRight: 8, accentColor: "var(--accent)" }}
          />
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            I have saved my recovery phrase in a safe place
          </span>
        </label>

        <button
          onClick={onClose}
          disabled={!confirmed}
          style={{
            ...primaryButtonStyle,
            opacity: confirmed ? 1 : 0.4,
            cursor: confirmed ? "pointer" : "not-allowed",
          }}
        >
          Continue
        </button>

        {!confirmed && !nostrOnly && (
          <>
            <button onClick={handleSkip} style={skipButtonStyle}>
              I'll do this later
            </button>
            {showSkipWarning && (
              <p style={{ fontSize: 12, color: "#e94560", marginTop: 8, textAlign: "center", lineHeight: 1.4 }}>
                Without this phrase, you cannot recover your cryptographic identity if you lose access to your account.
                You can retrieve it later from Account Settings using your password.
              </p>
            )}
          </>
        )}
        {!confirmed && nostrOnly && (
          <p style={{ fontSize: 12, color: "#e94560", marginTop: 12, textAlign: "center", lineHeight: 1.4 }}>
            This is your only way to sign in. There is no email or password recovery.
            You must save this phrase before continuing.
          </p>
        )}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(0, 0, 0, 0.7)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  backgroundColor: "var(--bg-secondary)",
  borderRadius: 12,
  border: "1px solid var(--border)",
  padding: "32px",
  maxWidth: 440,
  width: "90%",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: 8,
  marginBottom: 20,
  padding: 16,
  backgroundColor: "var(--bg-tertiary)",
  borderRadius: "var(--radius)",
  border: "1px solid var(--border)",
};

const wordStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "6px 8px",
};

const copyButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 0",
  borderRadius: "var(--radius)",
  backgroundColor: "var(--bg-tertiary)",
  border: "1px solid var(--border)",
  color: "var(--text-secondary)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  marginBottom: 16,
};

const checkboxLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  marginBottom: 16,
  cursor: "pointer",
};

const primaryButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 0",
  borderRadius: "var(--radius)",
  backgroundColor: "var(--accent)",
  color: "#fff",
  fontWeight: 700,
  fontSize: 14,
  border: "none",
  cursor: "pointer",
};

const skipButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 0",
  marginTop: 8,
  borderRadius: "var(--radius)",
  backgroundColor: "transparent",
  border: "none",
  color: "var(--text-muted)",
  fontSize: 12,
  cursor: "pointer",
};
