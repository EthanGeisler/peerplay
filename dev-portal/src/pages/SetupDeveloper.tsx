import { useState } from "react";
import { useAuthStore } from "../stores/authStore";

export function SetupDeveloper() {
  const [studioName, setStudioName] = useState("");
  const registerDeveloper = useAuthStore((s) => s.registerDeveloper);
  const error = useAuthStore((s) => s.error);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await registerDeveloper(studioName);
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
          maxWidth: 440,
          backgroundColor: "var(--bg-secondary)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
          padding: 32,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: "var(--accent)", letterSpacing: 2, marginBottom: 8 }}>
            PEERPLAY
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Become a Developer</h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            Set up your developer profile to start publishing games on Peerplay.
            You'll keep 99% of every sale.
          </p>
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
            <label style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>
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
              style={{ width: "100%" }}
            />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              This is how players will see your studio on the storefront.
            </div>
          </div>

          <button
            type="submit"
            style={{
              padding: "12px 24px",
              borderRadius: "var(--radius)",
              backgroundColor: "var(--accent)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Create Developer Profile
          </button>
        </form>
      </div>
    </div>
  );
}
