import { useState } from "react";

interface MnemonicModalProps {
  mnemonic: string;
  onClose: () => void;
}

export function MnemonicModal({ mnemonic, onClose }: MnemonicModalProps) {
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
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: "#ffffff" }}>
          Save Your Recovery Phrase
        </h2>
        <p style={{ fontSize: 13, color: "#aaa", marginBottom: 20, lineHeight: 1.5 }}>
          This 12-word phrase is the only way to recover your cryptographic identity.
          Write it down and store it somewhere safe. It will not be shown again.
        </p>

        <div style={gridStyle}>
          {words.map((word, i) => (
            <div key={i} style={wordStyle}>
              <span style={{ color: "#888", fontSize: 11, marginRight: 6, minWidth: 18, textAlign: "right" }}>
                {i + 1}.
              </span>
              <span style={{ color: "#e0e0e0", fontWeight: 600, fontSize: 14, fontFamily: "monospace" }}>
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
            style={{ marginRight: 8, accentColor: "#e94560" }}
          />
          <span style={{ fontSize: 13, color: "#aaa" }}>
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

        {!confirmed && (
          <>
            <button onClick={handleSkip} style={skipButtonStyle}>
              I'll do this later
            </button>
            {showSkipWarning && (
              <p style={{ fontSize: 12, color: "#e94560", marginTop: 8, textAlign: "center", lineHeight: 1.4 }}>
                Without this phrase, you cannot recover your cryptographic identity if you lose access to your account.
                You can retrieve it later from Settings using your password.
              </p>
            )}
          </>
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
  backgroundColor: "#16213e",
  borderRadius: 8,
  border: "1px solid #0f3460",
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
  backgroundColor: "#1a1a2e",
  borderRadius: 4,
  border: "1px solid #0f3460",
};

const wordStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "6px 8px",
};

const copyButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 0",
  borderRadius: 4,
  backgroundColor: "#1a1a2e",
  border: "1px solid #0f3460",
  color: "#aaa",
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
  borderRadius: 4,
  backgroundColor: "#e94560",
  color: "#fff",
  fontWeight: 600,
  fontSize: 14,
  border: "none",
  cursor: "pointer",
};

const skipButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 0",
  marginTop: 8,
  borderRadius: 4,
  backgroundColor: "transparent",
  border: "none",
  color: "#888",
  fontSize: 12,
  cursor: "pointer",
};
