import { useState } from "react";
import { apiFetch } from "../api";

interface ReviewFormProps {
  slug: string;
  onReviewSubmitted: () => void;
}

function StarSelector({
  rating,
  onSelect,
}: {
  rating: number;
  onSelect: (r: number) => void;
}) {
  const [hover, setHover] = useState(0);

  return (
    <div style={{ display: "flex", gap: 4 }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          onClick={() => onSelect(star)}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          style={{
            cursor: "pointer",
            fontSize: 28,
            color: star <= (hover || rating) ? "#f5c518" : "#555",
            transition: "color 0.1s",
            userSelect: "none",
          }}
        >
          {star <= (hover || rating) ? "\u2605" : "\u2606"}
        </span>
      ))}
    </div>
  );
}

/**
 * Attempt to sign the review locally and publish via relay WebSocket.
 * Falls back to REST if no key is available or relay publish fails.
 */
async function submitViaRelay(slug: string, rating: number, title: string, body: string): Promise<boolean> {
  try {
    // First, try to ensure we have cached relay keys
    // Fetch from server if not cached
    try {
      const keys = await apiFetch<{ pubkey: string; privkey: string | null }>("/relay/me/keys");
      if (keys.privkey) {
        await window.boilerdeck.events.cacheRelayKeys({
          pubkey: keys.pubkey,
          privkey: keys.privkey,
        });
      }
    } catch {
      // Key fetch failed — self-custody key might still work
    }

    // Ensure relay is connected
    const status = await window.boilerdeck.relay.status();
    if (!status.connected) {
      // Try to connect to the relay
      const apiBase = import.meta.env.VITE_API_BASE_URL ?? "https://boilerdeck.com/api";
      const relayUrl = apiBase.replace(/^https?:\/\//, "wss://").replace(/\/api$/, "/relay");
      await window.boilerdeck.relay.connect(relayUrl);
      // Give it a moment to connect
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const newStatus = await window.boilerdeck.relay.status();
      if (!newStatus.connected) {
        return false; // Can't connect to relay — fall back to REST
      }
    }

    // Sign and publish locally via main process IPC
    await window.boilerdeck.events.signAndPublishReview({
      slug,
      rating,
      title,
      body,
    });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "NO_KEY") {
      return false; // No key available — fall back to REST
    }
    console.warn("[ReviewForm] Local sign+publish failed, falling back to REST:", msg);
    return false;
  }
}

const formStyles = {
  container: {
    backgroundColor: "#16213e",
    borderRadius: 8,
    border: "1px solid #0f3460",
    padding: 24,
    marginTop: 24,
    maxWidth: 600,
  } as React.CSSProperties,
  heading: {
    fontSize: 18,
    fontWeight: 700,
    color: "#fff",
    marginBottom: 16,
  } as React.CSSProperties,
  label: {
    fontSize: 13,
    color: "#888",
    display: "block",
    marginBottom: 6,
  } as React.CSSProperties,
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 4,
    backgroundColor: "#1a1a2e",
    border: "1px solid #0f3460",
    color: "#fff",
    fontSize: 14,
    boxSizing: "border-box",
  } as React.CSSProperties,
  textarea: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 4,
    backgroundColor: "#1a1a2e",
    border: "1px solid #0f3460",
    color: "#fff",
    fontSize: 14,
    lineHeight: 1.6,
    resize: "vertical",
    boxSizing: "border-box",
    fontFamily: "inherit",
  } as React.CSSProperties,
  error: {
    padding: "8px 12px",
    borderRadius: 4,
    backgroundColor: "rgba(233,69,96,0.15)",
    color: "#e94560",
    fontSize: 12,
    marginBottom: 12,
  } as React.CSSProperties,
  submitBtn: {
    padding: "10px 24px",
    borderRadius: 4,
    backgroundColor: "#e94560",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    border: "none",
    cursor: "pointer",
  } as React.CSSProperties,
  success: {
    padding: "12px 16px",
    borderRadius: 4,
    backgroundColor: "rgba(74,222,128,0.15)",
    color: "#4ade80",
    fontSize: 14,
    fontWeight: 600,
  } as React.CSSProperties,
};

export function ReviewForm({ slug, onReviewSubmitted }: ReviewFormProps) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) {
      setError("Please select a rating.");
      return;
    }
    if (!title.trim()) {
      setError("Please enter a title.");
      return;
    }
    if (!body.trim()) {
      setError("Please enter a review body.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Try local signing + relay publish first (Electron-specific)
      const publishedViaRelay = await submitViaRelay(
        slug,
        rating,
        title.trim(),
        body.trim(),
      );

      if (!publishedViaRelay) {
        // Fall back to REST POST
        await apiFetch(`/games/${slug}/reviews`, {
          method: "POST",
          body: JSON.stringify({
            rating,
            title: title.trim(),
            body: body.trim(),
          }),
        });
      }

      setSuccess(true);
      onReviewSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit review.");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div style={formStyles.container}>
        <div style={formStyles.success}>
          Your review has been submitted. Thank you!
        </div>
      </div>
    );
  }

  return (
    <div style={formStyles.container}>
      <h2 style={formStyles.heading}>Write a Review</h2>

      {/* Star selector */}
      <div style={{ marginBottom: 16 }}>
        <label style={formStyles.label}>Rating</label>
        <StarSelector rating={rating} onSelect={setRating} />
      </div>

      {/* Title input */}
      <div style={{ marginBottom: 16 }}>
        <label style={formStyles.label}>Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Summarize your experience..."
          maxLength={200}
          style={formStyles.input}
        />
      </div>

      {/* Body textarea */}
      <div style={{ marginBottom: 16 }}>
        <label style={formStyles.label}>Review</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Share your thoughts about this game..."
          rows={4}
          maxLength={5000}
          style={formStyles.textarea}
        />
      </div>

      {/* Error message */}
      {error && <div style={formStyles.error}>{error}</div>}

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        style={{
          ...formStyles.submitBtn,
          opacity: submitting ? 0.7 : 1,
          cursor: submitting ? "default" : "pointer",
          backgroundColor: submitting ? "#333" : "#e94560",
        }}
      >
        {submitting ? "Submitting..." : "Submit Review"}
      </button>
    </div>
  );
}
