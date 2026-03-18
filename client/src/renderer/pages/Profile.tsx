import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { apiFetch } from "../api";
import type { NostrEvent } from "../types";

interface ProfileData {
  pubkey: string;
  name?: string;
  about?: string;
  picture?: string;
  created_at?: number;
}

function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 16) return pubkey;
  return `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`;
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const PLACEHOLDER_AVATAR = "https://placehold.co/120x120/0d1117/58a6ff?text=?&font=raleway";

const styles = {
  container: {} as React.CSSProperties,
  back: {
    background: "none",
    border: "none",
    color: "#e94560",
    cursor: "pointer",
    fontSize: 14,
    marginBottom: 16,
    padding: 0,
  } as React.CSSProperties,
  header: {
    display: "flex",
    gap: 24,
    marginBottom: 32,
    alignItems: "flex-start",
  } as React.CSSProperties,
  avatar: {
    width: 120,
    height: 120,
    borderRadius: "50%",
    objectFit: "cover",
    border: "3px solid #0f3460",
    flexShrink: 0,
  } as React.CSSProperties,
  nameRow: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    marginBottom: 8,
  } as React.CSSProperties,
  name: {
    fontSize: 28,
    fontWeight: 700,
    color: "#fff",
    margin: 0,
  } as React.CSSProperties,
  pubkey: {
    fontSize: 12,
    color: "#888",
    fontFamily: "monospace",
    backgroundColor: "#0a0a1a",
    padding: "4px 8px",
    borderRadius: 4,
    display: "inline-block",
    marginBottom: 12,
    wordBreak: "break-all",
  } as React.CSSProperties,
  bio: {
    fontSize: 14,
    color: "#ccc",
    lineHeight: 1.6,
    marginBottom: 12,
  } as React.CSSProperties,
  statsRow: {
    display: "flex",
    gap: 24,
    fontSize: 13,
    color: "#888",
  } as React.CSSProperties,
  followBtn: (isFollowing: boolean) =>
    ({
      padding: "6px 20px",
      borderRadius: 4,
      backgroundColor: isFollowing ? "#16213e" : "#e94560",
      color: isFollowing ? "#ccc" : "#fff",
      fontSize: 13,
      fontWeight: 600,
      border: isFollowing ? "1px solid #0f3460" : "none",
      cursor: "pointer",
      transition: "all 0.15s",
    }) as React.CSSProperties,
  section: {
    backgroundColor: "#16213e",
    borderRadius: 8,
    border: "1px solid #0f3460",
    padding: 24,
    marginBottom: 24,
    maxWidth: 600,
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: "#fff",
    marginBottom: 12,
  } as React.CSSProperties,
  loading: {
    color: "#888",
    fontSize: 16,
    marginTop: 40,
    textAlign: "center",
  } as React.CSSProperties,
};

export function Profile() {
  const { pubkey } = useParams<{ pubkey: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewCount, setReviewCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  const currentUserPubkey = user?.pubkey || user?.nostrPubkey;
  const isOwnProfile = currentUserPubkey && pubkey ? currentUserPubkey === pubkey : false;

  // Fetch profile data
  useEffect(() => {
    if (!pubkey) return;
    setLoading(true);

    apiFetch<ProfileData>(`/profiles/${pubkey}`)
      .then((data) => setProfile(data))
      .catch(() => setProfile({ pubkey }))
      .finally(() => setLoading(false));
  }, [pubkey]);

  // Fetch review count
  useEffect(() => {
    if (!pubkey) return;
    apiFetch<NostrEvent[]>(`/events?kinds=31337&authors=${pubkey}`)
      .then((events) => setReviewCount(Array.isArray(events) ? events.length : 0))
      .catch(() => setReviewCount(0));
  }, [pubkey]);

  // Fetch current user's follow list
  useEffect(() => {
    if (!currentUserPubkey || !pubkey || isOwnProfile) {
      setIsFollowing(false);
      return;
    }
    apiFetch<{ follows: string[] }>(`/follows/${currentUserPubkey}`)
      .then((data) => setIsFollowing((data.follows || []).includes(pubkey)))
      .catch(() => setIsFollowing(false));
  }, [currentUserPubkey, pubkey, isOwnProfile]);

  const handleFollow = async () => {
    if (!pubkey || followLoading) return;
    setFollowLoading(true);
    try {
      await apiFetch<{ follows: string[] }>("/follows", {
        method: "POST",
        body: JSON.stringify({ pubkey }),
      });
      setIsFollowing(true);
    } catch {
      // Silently fail
    } finally {
      setFollowLoading(false);
    }
  };

  const handleUnfollow = async () => {
    if (!pubkey || followLoading) return;
    setFollowLoading(true);
    try {
      await apiFetch<{ follows: string[] }>(`/follows/${pubkey}`, {
        method: "DELETE",
      });
      setIsFollowing(false);
    } catch {
      // Silently fail
    } finally {
      setFollowLoading(false);
    }
  };

  if (loading) {
    return (
      <div>
        <button style={styles.back} onClick={() => navigate(-1)}>
          &larr; Back
        </button>
        <p style={styles.loading}>Loading...</p>
      </div>
    );
  }

  const displayName = profile?.name || truncatePubkey(pubkey || "");
  const bio = profile?.about || "";
  const avatar = profile?.picture || PLACEHOLDER_AVATAR;

  return (
    <div>
      <button style={styles.back} onClick={() => navigate(-1)}>
        &larr; Back
      </button>

      {/* Profile Header */}
      <div style={styles.header}>
        <img
          src={avatar}
          alt={displayName}
          style={styles.avatar}
          onError={(e) => {
            (e.target as HTMLImageElement).src = PLACEHOLDER_AVATAR;
          }}
        />

        <div style={{ flex: 1 }}>
          <div style={styles.nameRow}>
            <h1 style={styles.name}>{displayName}</h1>
            {user && !isOwnProfile && (
              <button
                onClick={isFollowing ? handleUnfollow : handleFollow}
                disabled={followLoading}
                style={{
                  ...styles.followBtn(isFollowing),
                  opacity: followLoading ? 0.7 : 1,
                  cursor: followLoading ? "default" : "pointer",
                }}
              >
                {followLoading ? "..." : isFollowing ? "Unfollow" : "Follow"}
              </button>
            )}
          </div>

          <div style={styles.pubkey}>{pubkey}</div>

          <p style={{ ...styles.bio, color: bio ? "#ccc" : "#666", fontStyle: bio ? "normal" : "italic" }}>
            {bio || "No bio yet."}
          </p>

          <div style={styles.statsRow}>
            {profile?.created_at && (
              <div>
                Member since <span style={{ color: "#e0e0e0" }}>{formatDate(profile.created_at)}</span>
              </div>
            )}
            <div>
              <span style={{ color: "#fff", fontWeight: 600 }}>{reviewCount}</span>{" "}
              {reviewCount === 1 ? "review" : "reviews"}
            </div>
          </div>
        </div>
      </div>

      {/* Seeder Reputation Placeholder */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Seeder Reputation</h2>
        <p style={{ fontSize: 14, color: "#888" }}>
          Seeder Score: Coming Soon
        </p>
        <p style={{ fontSize: 12, color: "#888" }}>
          Seeder reputation tracking will be available in a future update. This section will display
          the user's seeding history, attestation count, and trust score.
        </p>
      </div>
    </div>
  );
}
