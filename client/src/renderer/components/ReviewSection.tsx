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

const sectionStyles = {
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
  summaryRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  } as React.CSSProperties,
  avgRating: {
    fontSize: 18,
    fontWeight: 700,
    color: "#fff",
  } as React.CSSProperties,
  reviewCountText: {
    fontSize: 13,
    color: "#888",
  } as React.CSSProperties,
  emptyText: {
    fontSize: 14,
    color: "#888",
    marginBottom: 0,
  } as React.CSSProperties,
  card: {
    backgroundColor: "#1a1a2e",
    borderRadius: 4,
    padding: 16,
    marginBottom: 12,
  } as React.CSSProperties,
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  } as React.CSSProperties,
  cardAuthorRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } as React.CSSProperties,
  pubkey: {
    fontSize: 12,
    color: "#888",
    fontFamily: "monospace",
    backgroundColor: "#0a0a1a",
    padding: "2px 6px",
    borderRadius: 4,
  } as React.CSSProperties,
  timestamp: {
    fontSize: 12,
    color: "#888",
  } as React.CSSProperties,
  cardTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "#fff",
    marginBottom: 4,
  } as React.CSSProperties,
  cardBody: {
    fontSize: 13,
    color: "#ccc",
    lineHeight: 1.6,
  } as React.CSSProperties,
  loadMoreBtn: {
    display: "block",
    width: "100%",
    padding: "10px 0",
    borderRadius: 4,
    backgroundColor: "#1a1a2e",
    color: "#ccc",
    fontSize: 13,
    fontWeight: 600,
    marginTop: 4,
    cursor: "pointer",
    border: "1px solid #0f3460",
  } as React.CSSProperties,
};

export function ReviewSection({ slug, refreshKey }: { slug: string; refreshKey?: number }) {
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
  }, [slug, fetchReviews, refreshKey]);

  const handleLoadMore = () => {
    const newOffset = offset + REVIEWS_PER_PAGE;
    setOffset(newOffset);
    fetchReviews(newOffset, true);
  };

  if (!initialLoaded) return null;

  return (
    <div style={sectionStyles.container}>
      <h2 style={sectionStyles.heading}>Reviews</h2>

      {reviewCount > 0 ? (
        <div style={sectionStyles.summaryRow}>
          <StarRating rating={Math.round(averageRating)} size={20} />
          <span style={sectionStyles.avgRating}>{averageRating.toFixed(1)}</span>
          <span style={sectionStyles.reviewCountText}>
            ({reviewCount} {reviewCount === 1 ? "review" : "reviews"})
          </span>
        </div>
      ) : (
        <p style={sectionStyles.emptyText}>No reviews yet.</p>
      )}

      {reviews.map((review) => (
        <div key={review.eventId} style={sectionStyles.card}>
          <div style={sectionStyles.cardHeader}>
            <div style={sectionStyles.cardAuthorRow}>
              <span style={sectionStyles.pubkey}>{truncatePubkey(review.pubkey)}</span>
              <StarRating rating={review.rating} size={14} />
            </div>
            <span style={sectionStyles.timestamp}>{formatTimestamp(review.created_at)}</span>
          </div>
          <div style={sectionStyles.cardTitle}>{review.title}</div>
          <div style={sectionStyles.cardBody}>{review.body}</div>
        </div>
      ))}

      {hasMore && (
        <button
          onClick={handleLoadMore}
          disabled={loading}
          style={{
            ...sectionStyles.loadMoreBtn,
            opacity: loading ? 0.7 : 1,
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? "Loading..." : "Load More Reviews"}
        </button>
      )}
    </div>
  );
}
