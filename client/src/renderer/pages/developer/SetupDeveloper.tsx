import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { openStripeOnboard } from "../../devApi";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #0f3460",
  backgroundColor: "#0f3460",
  color: "#e0e0e0",
  fontSize: 14,
  outline: "none",
};

export function SetupDeveloper() {
  const navigate = useNavigate();
  const [studioName, setStudioName] = useState("");
  const registerDeveloper = useAuthStore((s) => s.registerDeveloper);
  const developer = useAuthStore((s) => s.developer);
  const error = useAuthStore((s) => s.error);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await registerDeveloper(studioName);
  };

  const handleStripeConnect = async () => {
    setStripeLoading(true);
    setStripeError(null);
    try {
      const opened = await openStripeOnboard();
      if (!opened) setStripeLoading(false);
    } catch (err) {
      console.error("Stripe onboard failed:", err);
      setStripeError("Failed to start Stripe setup. Please try again.");
      setStripeLoading(false);
    }
  };

  // After registration, show Stripe connect step
  if (developer) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "60vh",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 440,
            backgroundColor: "#16213e",
            borderRadius: 12,
            border: "1px solid #0f3460",
            padding: 32,
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              backgroundColor: "rgba(63,185,80,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
              fontSize: 24,
              color: "#3fb950",
            }}
          >
            {"\u2713"}
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Profile Created!</h1>
          <p style={{ fontSize: 14, color: "#aaa", marginBottom: 24, lineHeight: 1.6 }}>
            Connect your Stripe account to start receiving payments for your games.
            You can also do this later from your Dashboard.
          </p>

          {stripeError && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                backgroundColor: "rgba(233, 69, 96, 0.1)",
                border: "1px solid rgba(233, 69, 96, 0.3)",
                color: "#e94560",
                fontSize: 13,
                marginBottom: 12,
                textAlign: "left",
              }}
            >
              {stripeError}
            </div>
          )}

          <button
            onClick={handleStripeConnect}
            disabled={stripeLoading}
            style={{
              padding: "12px 24px",
              borderRadius: 8,
              backgroundColor: "#635bff",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 12,
              width: "100%",
              border: "none",
              cursor: "pointer",
              opacity: stripeLoading ? 0.7 : 1,
            }}
          >
            {stripeLoading ? "Opening Stripe..." : "Connect with Stripe"}
          </button>

          <button
            onClick={() => navigate("/developer")}
            style={{
              padding: "12px 24px",
              borderRadius: 8,
              backgroundColor: "#0f3460",
              color: "#aaa",
              fontSize: 14,
              width: "100%",
              border: "none",
              cursor: "pointer",
            }}
          >
            Skip for Now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          backgroundColor: "#16213e",
          borderRadius: 12,
          border: "1px solid #0f3460",
          padding: 32,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#e94560", letterSpacing: 2, marginBottom: 8 }}>
            BOILERDECK
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Become a Developer</h1>
          <p style={{ fontSize: 14, color: "#aaa" }}>
            Set up your developer profile to start publishing games on BoilerDeck.
            You'll keep 99% of every sale.
          </p>
        </div>

        {error && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              backgroundColor: "rgba(233, 69, 96, 0.1)",
              border: "1px solid rgba(233, 69, 96, 0.3)",
              color: "#e94560",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 13, color: "#aaa", marginBottom: 6 }}>
              Studio Name
            </label>
            <input
              type="text"
              value={studioName}
              onChange={(e) => setStudioName(e.target.value)}
              placeholder="My Awesome Studio"
              required
              minLength={2}
              maxLength={100}
              style={inputStyle}
            />
            <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
              This is how players will see your studio on the storefront.
            </div>
          </div>

          <button
            type="submit"
            style={{
              padding: "12px 24px",
              borderRadius: 8,
              backgroundColor: "#e94560",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
            }}
          >
            Create Developer Profile
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 16 }}>
          <span
            onClick={() => navigate("/")}
            style={{
              fontSize: 13,
              color: "#888",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#aaa"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#888"; }}
          >
            Not a developer? Return to Store
          </span>
        </div>
      </div>
    </div>
  );
}
