import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLibraryStore } from "../stores/libraryStore";
import { useAuthStore } from "../stores/authStore";

export function CheckoutSuccess() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const licenses = useLibraryStore((s) => s.licenses);
  const fetchLicenses = useLibraryStore((s) => s.fetchLicenses);
  const [ready, setReady] = useState(false);

  const prevCount = useState(licenses.length)[0];

  useEffect(() => {
    if (!user) return;

    // Poll for the new license (webhook may not have fired yet)
    const poll = () => fetchLicenses();
    poll();

    const interval = setInterval(() => {
      if (ready) return;
      poll();
    }, 2000);

    // Stop polling after 12 seconds
    const timeout = setTimeout(() => {
      clearInterval(interval);
      setReady(true);
    }, 12000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [user, fetchLicenses]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mark ready once we detect a new license
  useEffect(() => {
    if (licenses.length > prevCount) {
      setReady(true);
    }
  }, [licenses.length, prevCount]);

  // Unauthenticated: prompt to sign in
  if (!loading && !user) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0", maxWidth: 500, margin: "0 auto" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>
          Sign in to verify your purchase
        </h1>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 32, lineHeight: 1.6 }}>
          Your payment was received. Please sign in to access your library.
        </p>
        <Link
          to="/login"
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
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center", padding: "80px 0", maxWidth: 500, margin: "0 auto" }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          backgroundColor: "rgba(63,185,80,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 24px",
          fontSize: 32,
        }}
      >
        {ready ? "\u2713" : "\u231B"}
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>
        {ready ? "Payment Successful!" : "Processing Payment..."}
      </h1>

      <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 32, lineHeight: 1.6 }}>
        {ready
          ? "Your game has been added to your library. You can download it anytime from your Library page."
          : "Confirming your purchase. This usually takes just a moment..."}
      </p>

      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
        <Link
          to="/library"
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
          Go to Library
        </Link>
        <Link
          to="/"
          style={{
            padding: "10px 24px",
            borderRadius: "var(--radius)",
            backgroundColor: "var(--bg-tertiary)",
            color: "var(--text-secondary)",
            fontWeight: 600,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Back to Store
        </Link>
      </div>
    </div>
  );
}
