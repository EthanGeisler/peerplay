import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
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

interface ReputationData {
  pubkey: string;
  score: number;
  attestationCount: number;
  uniqueAttesters: number;
}

function getBadge(score: number): { label: string; color: string; bgColor: string } | null {
  if (score >= 200) return { label: "Gold", color: "#ffd700", bgColor: "rgba(255,215,0,0.15)" };
  if (score >= 50) return { label: "Silver", color: "#c0c0c0", bgColor: "rgba(192,192,192,0.15)" };
  if (score >= 10) return { label: "Bronze", color: "#cd7f32", bgColor: "rgba(205,127,50,0.15)" };
  return null;
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

export function Profile() {
  const { pubkey } = useParams<{ pubkey: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const [follows, setFollows] = useState<string[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [reputation, setReputation] = useState<ReputationData | null>(null);

  const currentUserPubkey = user?.pubkey || user?.nostrPubkey;
  const isOwnProfile = currentUserPubkey && pubkey ? currentUserPubkey === pubkey : false;

  // Fetch profile data
  useEffect(() => {
    if (!pubkey) return;
    setLoading(true);
    setError(null);

    apiFetch<ProfileData>(`/profiles/${pubkey}`)
      .then((data) => {
        setProfile(data);
      })
      .catch(() => {
        // Profile event doesn't exist — show minimal profile with just pubkey
        setProfile({ pubkey });
      })
      .finally(() => setLoading(false));
  }, [pubkey]);

  // Fetch review count
  useEffect(() => {
    if (!pubkey) return;
    apiFetch<NostrEvent[]>(`/events?kinds=31337&authors=${pubkey}`)
      .then((events) => {
        setReviewCount(Array.isArray(events) ? events.length : 0);
      })
      .catch(() => setReviewCount(0));
  }, [pubkey]);

  // Fetch current user's follow list to check if we follow this profile
  useEffect(() => {
    if (!currentUserPubkey || !pubkey || isOwnProfile) {
      setIsFollowing(false);
      return;
    }
    apiFetch<{ follows: string[] }>(`/follows/${currentUserPubkey}`)
      .then((data) => {
        setFollows(data.follows || []);
        setIsFollowing((data.follows || []).includes(pubkey));
      })
      .catch(() => {
        setFollows([]);
        setIsFollowing(false);
      });
  }, [currentUserPubkey, pubkey, isOwnProfile]);

  // Fetch reputation data
  useEffect(() => {
    if (!pubkey) return;
    apiFetch<ReputationData>(`/reputation/${pubkey}`)
      .then((data) => setReputation(data))
      .catch(() => setReputation(null));
  }, [pubkey]);

  const handleFollow = async () => {
    if (!pubkey || followLoading) return;
    setFollowLoading(true);
    try {
      const data = await apiFetch<{ follows: string[] }>("/follows", {
        method: "POST",
        body: JSON.stringify({ pubkey }),
      });
      setFollows(data.follows || []);
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
      const data = await apiFetch<{ follows: string[] }>(`/follows/${pubkey}`, {
        method: "DELETE",
      });
      setFollows(data.follows || []);
      setIsFollowing(false);
    } catch {
      // Silently fail
    } finally {
      setFollowLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0", color: "var(--text-secondary)" }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0" }}>
        <h2 style={{ fontSize: 24, marginBottom: 12 }}>Profile not found</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>{error}</p>
        <button
          onClick={() => navigate("/")}
          style={{
            padding: "8px 20px",
            borderRadius: "var(--radius)",
            backgroundColor: "var(--accent)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Back to Store
        </button>
      </div>
    );
  }

  const displayName = profile?.name || truncatePubkey(pubkey || "");
  const bio = profile?.about || "";
  const avatar = profile?.picture || PLACEHOLDER_AVATAR;

  return (
    <div>
      <button
        onClick={() => navigate(-1)}
        style={{
          padding: "6px 14px",
          borderRadius: "var(--radius)",
          backgroundColor: "var(--bg-tertiary)",
          color: "var(--text-secondary)",
          fontSize: 13,
          marginBottom: 24,
        }}
      >
        &larr; Back
      </button>

      {/* Profile Header */}
      <div
        style={{
          display: "flex",
          gap: 24,
          marginBottom: 32,
          alignItems: "flex-start",
        }}
      >
        {/* Avatar */}
        <img
          src={avatar}
          alt={displayName}
          style={{
            width: 120,
            height: 120,
            borderRadius: "50%",
            objectFit: "cover",
            border: "3px solid var(--border)",
            flexShrink: 0,
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).src = PLACEHOLDER_AVATAR;
          }}
        />

        {/* Info */}
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>{displayName}</h1>
            {/* Follow/Unfollow button — only if logged in and not own profile */}
            {user && !isOwnProfile && (
              <button
                onClick={isFollowing ? handleUnfollow : handleFollow}
                disabled={followLoading}
                style={{
                  padding: "6px 20px",
                  borderRadius: "var(--radius)",
                  backgroundColor: isFollowing ? "var(--bg-tertiary)" : "var(--accent)",
                  color: isFollowing ? "var(--text-secondary)" : "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  border: isFollowing ? "1px solid var(--border)" : "none",
                  opacity: followLoading ? 0.7 : 1,
                  cursor: followLoading ? "default" : "pointer",
                  transition: "all 0.15s",
                }}
              >
                {followLoading ? "..." : isFollowing ? "Unfollow" : "Follow"}
              </button>
            )}
          </div>

          {/* Pubkey */}
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              fontFamily: "monospace",
              backgroundColor: "var(--bg-tertiary)",
              padding: "4px 8px",
              borderRadius: "var(--radius)",
              display: "inline-block",
              marginBottom: 12,
              wordBreak: "break-all",
            }}
          >
            {pubkey}
          </div>

          {/* Bio */}
          <p style={{ fontSize: 14, color: bio ? "var(--text-secondary)" : "var(--text-muted)", lineHeight: 1.6, marginBottom: 12, fontStyle: bio ? "normal" : "italic" }}>
            {bio || "No bio yet."}
          </p>

          {/* Stats row */}
          <div style={{ display: "flex", gap: 24, fontSize: 13, color: "var(--text-muted)" }}>
            {profile?.created_at && (
              <div>
                Member since <span style={{ color: "var(--text-secondary)" }}>{formatDate(profile.created_at)}</span>
              </div>
            )}
            <div>
              <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{reviewCount}</span>{" "}
              {reviewCount === 1 ? "review" : "reviews"}
            </div>
          </div>
        </div>
      </div>

      {/* Seeder Reputation */}
      <div
        style={{
          backgroundColor: "var(--bg-secondary)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)",
          padding: 24,
          marginBottom: 24,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Seeder Reputation</h2>
        {reputation && reputation.score > 0 ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: "var(--text-primary)" }}>
                {reputation.score.toFixed(1)}
              </span>
              <span style={{ fontSize: 14, color: "var(--text-muted)" }}>Seeder Score</span>
              {(() => {
                const badge = getBadge(reputation.score);
                if (!badge) return null;
                return (
                  <span
                    style={{
                      padding: "4px 10px",
                      borderRadius: "var(--radius)",
                      backgroundColor: badge.bgColor,
                      color: badge.color,
                      fontSize: 12,
                      fontWeight: 700,
                      border: `1px solid ${badge.color}`,
                    }}
                  >
                    {badge.label}
                  </span>
                );
              })()}
            </div>
            <div style={{ display: "flex", gap: 24, fontSize: 13, color: "var(--text-muted)" }}>
              <div>
                <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{reputation.attestationCount}</span>{" "}
                {reputation.attestationCount === 1 ? "attestation" : "attestations"}
              </div>
              <div>
                <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{reputation.uniqueAttesters}</span>{" "}
                unique {reputation.uniqueAttesters === 1 ? "attester" : "attesters"}
              </div>
            </div>
          </>
        ) : (
          <p style={{ fontSize: 14, color: "var(--text-muted)" }}>
            No seeding activity yet
          </p>
        )}
      </div>
    </div>
  );
}
