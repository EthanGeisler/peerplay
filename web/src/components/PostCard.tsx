import { Link } from "react-router-dom";
import type { NostrEvent } from "../types";
import { formatRelativeTime } from "../utils";

interface PostCardProps {
  event: NostrEvent;
  authorName?: string;
  authorPicture?: string;
}

export function PostCard({ event, authorName, authorPicture }: PostCardProps) {
  const displayName = authorName || event.pubkey.slice(0, 12) + "...";

  return (
    <div
      style={{
        backgroundColor: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 16,
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <Link to={`/profile/${event.pubkey}`} style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 10 }}>
          {authorPicture ? (
            <img
              src={authorPicture}
              alt=""
              style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                backgroundColor: "var(--bg-tertiary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-secondary)",
              }}
            >
              {displayName[0]?.toUpperCase()}
            </div>
          )}
          <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>
            {displayName}
          </span>
        </Link>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {formatRelativeTime(event.created_at)}
        </span>
      </div>
      <div style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
        {event.content}
      </div>
    </div>
  );
}
