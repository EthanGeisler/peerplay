import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "../api";
import type { ApiReview, ApiReviewsResponse } from "../types";

const REVIEWS_PER_PAGE = 10;

function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 12) return pubkey;
  return `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`;
}

function StarRating({ rating, size = 16 }: { rating: number; size?: number }) {
  const stars: string[] = [];
  for (let i = 1; i <= 5; i++) {
    stars.push(i <= rating ? "\u2605" : "\u2606");
  }
  return (
    <span style={{ color: "#f5c518", fontSize: size, letterSpacing: 2 }}>
      {stars.join("")}
    </span>
  );
}

function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

export function ReviewSection({ slug }: { slug: string }) {
  const [reviews, setReviews] = useState<ApiReview[]>([]);
  const [averageRating, setAverageRating] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const fetchReviews = useCallback(
    async (currentOffset: number, append: boolean) => {
      setLoading(true);
      try {
        const data = await apiFetch<ApiReviewsResponse>(
          `/games/${slug}/reviews?limit=${REVIEWS_PER_PAGE}&offset=${currentOffset}`
        );
        if (append) {
          setReviews((prev) => [...prev, ...data.reviews]);
        } else {
          setReviews(data.reviews);
        }
        setAverageRating(data.averageRating);
        setReviewCount(data.reviewCount);
        setHasMore(currentOffset + data.reviews.length < data.reviewCount);
      } catch {
        // Silently fail — reviews are non-critical
      } finally {
        setLoading(false);
        setInitialLoaded(true);
      }
    },
    [slug]
  );

  useEffect(() => {
    setReviews([]);
    setOffset(0);
    setInitialLoaded(false);
    fetchReviews(0, false);
  }, [slug, fetchReviews]);

  const handleLoadMore = () => {
    const newOffset = offset + REVIEWS_PER_PAGE;
    setOffset(newOffset);
    fetchReviews(newOffset, true);
  };

  if (!initialLoaded) return null;

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
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Reviews</h2>

      {/* Average rating summary */}
      {reviewCount > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <StarRating rating={Math.round(averageRating)} size={20} />
          <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
            {averageRating.toFixed(1)}
          </span>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            ({reviewCount} {reviewCount === 1 ? "review" : "reviews"})
          </span>
        </div>
      ) : (
        <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 0 }}>
          No reviews yet.
        </p>
      )}

      {/* Individual review cards */}
      {reviews.map((review) => (
        <div
          key={review.eventId}
          style={{
            backgroundColor: "var(--bg-tertiary)",
            borderRadius: "var(--radius)",
            padding: 16,
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  fontFamily: "monospace",
                  backgroundColor: "var(--bg-primary)",
                  padding: "2px 6px",
                  borderRadius: "var(--radius)",
                }}
              >
                {truncatePubkey(review.pubkey)}
              </span>
              <StarRating rating={review.rating} size={14} />
            </div>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {formatTimestamp(review.created_at)}
            </span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
            {review.title}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            {review.body}
          </div>
        </div>
      ))}

      {/* Load More button */}
      {hasMore && (
        <button
          onClick={handleLoadMore}
          disabled={loading}
          style={{
            display: "block",
            width: "100%",
            padding: "10px 0",
            borderRadius: "var(--radius)",
            backgroundColor: "var(--bg-tertiary)",
            color: "var(--text-secondary)",
            fontSize: 13,
            fontWeight: 600,
            marginTop: 4,
            opacity: loading ? 0.7 : 1,
            cursor: loading ? "default" : "pointer",
            border: "1px solid var(--border)",
          }}
        >
          {loading ? "Loading..." : "Load More Reviews"}
        </button>
      )}
    </div>
  );
}
