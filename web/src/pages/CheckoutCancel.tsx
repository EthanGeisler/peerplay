import { Link } from "react-router-dom";

export function CheckoutCancel() {
  return (
    <div style={{ textAlign: "center", padding: "80px 0", maxWidth: 500, margin: "0 auto" }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          backgroundColor: "rgba(233,69,96,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 24px",
          fontSize: 32,
        }}
      >
        &times;
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>Purchase Cancelled</h1>

      <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 32, lineHeight: 1.6 }}>
        No charge was made. You can try again anytime.
      </p>

      <Link
        to="/"
        style={{
          padding: "10px 24px",
          borderRadius: "var(--radius)",
          backgroundColor: "var(--accent)",
          color: "#fff",
          fontWeight: 600,
          fontSize: 14,
          textDecoration: "none",
        }}
      >
        Back to Store
      </Link>
    </div>
  );
}
