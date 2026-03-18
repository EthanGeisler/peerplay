import { useState } from "react";
import { apiFetch } from "../api";
import type { NostrEvent } from "../types";

interface ComposeBoxProps {
  onPost: (event: NostrEvent) => void;
}

export function ComposeBox({ onPost }: ComposeBoxProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      const event = await apiFetch<NostrEvent>("/events/sign-and-publish", {
        method: "POST",
        body: JSON.stringify({ kind: 1, content: text.trim(), tags: [] }),
      });
      onPost(event);
      setText("");
    } catch (err) {
      console.error("Failed to post:", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        backgroundColor: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 16,
        marginBottom: 20,
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What's on your mind?"
        rows={3}
        style={{
          width: "100%",
          backgroundColor: "var(--bg-primary)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: 12,
          fontSize: 14,
          color: "var(--text-primary)",
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <button
          onClick={handleSubmit}
          disabled={!text.trim() || submitting}
          style={{
            padding: "8px 20px",
            borderRadius: "var(--radius)",
            backgroundColor: !text.trim() || submitting ? "var(--bg-tertiary)" : "var(--accent)",
            color: !text.trim() || submitting ? "var(--text-muted)" : "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: !text.trim() || submitting ? "not-allowed" : "pointer",
          }}
        >
          {submitting ? "Posting..." : "Post"}
        </button>
      </div>
    </div>
  );
}
