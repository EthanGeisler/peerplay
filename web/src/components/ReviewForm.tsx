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
            color: star <= (hover || rating) ? "#f5c518" : "var(--text-muted)",
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
      await apiFetch(`/games/${slug}/reviews`, {
        method: "POST",
        body: JSON.stringify({ rating, title: title.trim(), body: body.trim() }),
      });
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
      <div
        style={{
          backgroundColor: "var(--bg-secondary)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
          padding: 24,
          marginTop: 24,
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "var(--radius)",
            backgroundColor: "rgba(63,185,80,0.15)",
            color: "var(--accent-green)",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Your review has been submitted. Thank you!
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        backgroundColor: "var(--bg-secondary)",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border)",
        padding: 24,
        marginTop: 24,
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Write a Review</h2>

      {/* Star selector */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 13, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
          Rating
        </label>
        <StarSelector rating={rating} onSelect={setRating} />
      </div>

      {/* Title input */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 13, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Summarize your experience..."
          maxLength={200}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: "var(--radius)",
            backgroundColor: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
            fontSize: 14,
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Body textarea */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 13, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
          Review
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Share your thoughts about this game..."
          rows={4}
          maxLength={5000}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: "var(--radius)",
            backgroundColor: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
            fontSize: 14,
            lineHeight: 1.6,
            resize: "vertical",
            boxSizing: "border-box",
            fontFamily: "inherit",
          }}
        />
      </div>

      {/* Error message */}
      {error && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: "var(--radius)",
            backgroundColor: "rgba(233,69,96,0.15)",
            color: "#e94560",
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        style={{
          padding: "10px 24px",
          borderRadius: "var(--radius)",
          backgroundColor: submitting ? "var(--bg-tertiary)" : "var(--accent)",
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          opacity: submitting ? 0.7 : 1,
          cursor: submitting ? "default" : "pointer",
          border: "none",
          transition: "background-color 0.15s",
        }}
      >
        {submitting ? "Submitting..." : "Submit Review"}
      </button>
    </div>
  );
}
