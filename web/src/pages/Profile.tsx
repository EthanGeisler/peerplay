import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { apiFetch } from "../api";
import type { NostrEvent, ProfileData } from "../types";
import { formatRelativeTime } from "../utils";

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

function renderStars(rating: number): string {
  return "\u2605".repeat(rating) + "\u2606".repeat(5 - rating);
}

const PLACEHOLDER_AVATAR = "https://placehold.co/120x120/0d1117/58a6ff?text=?&font=raleway";

type Tab = "reviews" | "posts" | "following" | "followers";

export function Profile() {
  const { pubkey } = useParams<{ pubkey: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [follows, setFollows] = useState<string[]>([]);
  const [followers, setFollowers] = useState<string[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [reputation, setReputation] = useState<ReputationData | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [muteLoading, setMuteLoading] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>("reviews");
  const [reviews, setReviews] = useState<NostrEvent[]>([]);
  const [posts, setPosts] = useState<NostrEvent[]>([]);
  const [reviewsLoaded, setReviewsLoaded] = useState(false);
  const [postsLoaded, setPostsLoaded] = useState(false);
  const [followingLoaded, setFollowingLoaded] = useState(false);
  const [followersLoaded, setFollowersLoaded] = useState(false);

  // Profile cache for following/followers lists
  const profileCache = useRef(new Map<string, ProfileData>());
  const [profileVersion, setProfileVersion] = useState(0);

  // Game title cache for reviews
  const gameTitleCache = useRef(new Map<string, string>());
  const [gameTitleVersion, setGameTitleVersion] = useState(0);

  const currentUserPubkey = user?.pubkey || user?.nostrPubkey;
  const isOwnProfile = currentUserPubkey && pubkey ? currentUserPubkey === pubkey : false;

  // Guard ref to prevent stale fetches from updating state for a different pubkey
  const activePubkeyRef = useRef(pubkey);
  useEffect(() => {
    activePubkeyRef.current = pubkey;
  }, [pubkey]);

  // Fetch profile data
  useEffect(() => {
    if (!pubkey) return;
    setLoading(true);
    profileCache.current.clear();
    // Reset tab state
    setReviewsLoaded(false);
    setPostsLoaded(false);
    setFollowingLoaded(false);
    setFollowersLoaded(false);
    setReviews([]);
    setPosts([]);
    setFollows([]);
    setFollowers([]);
    setActiveTab("reviews");

    apiFetch<ProfileData>(`/profiles/${pubkey}`)
      .then((data) => setProfile(data))
      .catch(() => setProfile({ pubkey }))
      .finally(() => setLoading(false));
  }, [pubkey]);

  // Fetch reputation
  useEffect(() => {
    if (!pubkey) return;
    apiFetch<ReputationData>(`/reputation/${pubkey}`)
      .then((data) => setReputation(data))
      .catch(() => setReputation(null));
  }, [pubkey]);

  // Fetch current user's follow list to check if we follow this profile
  useEffect(() => {
    if (!currentUserPubkey || !pubkey || isOwnProfile) {
      setIsFollowing(false);
      return;
    }
    apiFetch<{ follows: string[] }>(`/follows/${currentUserPubkey}`)
      .then((data) => setIsFollowing((data.follows || []).includes(pubkey)))
      .catch(() => setIsFollowing(false));
  }, [currentUserPubkey, pubkey, isOwnProfile]);

  // Check mute status
  useEffect(() => {
    if (!user || !pubkey || isOwnProfile) {
      setIsMuted(false);
      return;
    }
    apiFetch<{ muted: string[] }>("/moderation/mute")
      .then((data) => setIsMuted((data.muted || []).includes(pubkey.toLowerCase())))
      .catch(() => setIsMuted(false));
  }, [user, pubkey, isOwnProfile]);

  // Lazy-load tab data (guarded against stale pubkey)
  useEffect(() => {
    if (!pubkey) return;
    const currentPk = pubkey;

    if (activeTab === "reviews" && !reviewsLoaded) {
      apiFetch<NostrEvent[]>(`/events?kinds=31337&authors=${pubkey}`)
        .then((events) => {
          if (activePubkeyRef.current !== currentPk) return;
          const arr = Array.isArray(events) ? events : [];
          setReviews(arr);
          setReviewsLoaded(true);
          const slugs = new Set<string>();
          for (const ev of arr) {
            const dTag = (ev.tags as string[][]).find((t) => t[0] === "d");
            if (dTag?.[1]) slugs.add(dTag[1]);
          }
          for (const slug of slugs) {
            if (!gameTitleCache.current.has(slug)) {
              apiFetch<{ title: string }>(`/games/${slug}`)
                .then((g) => {
                  gameTitleCache.current.set(slug, g.title);
                  setGameTitleVersion((v) => v + 1);
                })
                .catch(() => {
                  gameTitleCache.current.set(slug, slug);
                  setGameTitleVersion((v) => v + 1);
                });
            }
          }
        })
        .catch(() => { if (activePubkeyRef.current === currentPk) setReviewsLoaded(true); });
    }

    if (activeTab === "posts" && !postsLoaded) {
      apiFetch<NostrEvent[]>(`/events?kinds=1&authors=${pubkey}&limit=50`)
        .then((events) => {
          if (activePubkeyRef.current !== currentPk) return;
          setPosts(Array.isArray(events) ? events : []);
          setPostsLoaded(true);
        })
        .catch(() => { if (activePubkeyRef.current === currentPk) setPostsLoaded(true); });
    }

    if (activeTab === "following" && !followingLoaded) {
      apiFetch<{ follows: string[] }>(`/follows/${pubkey}`)
        .then((data) => {
          if (activePubkeyRef.current !== currentPk) return;
          const list = data.follows || [];
          setFollows(list);
          setFollowingLoaded(true);
          resolveProfiles(list);
        })
        .catch(() => { if (activePubkeyRef.current === currentPk) setFollowingLoaded(true); });
    }

    if (activeTab === "followers" && !followersLoaded) {
      apiFetch<{ followers: string[] }>(`/followers/${pubkey}`)
        .then((data) => {
          if (activePubkeyRef.current !== currentPk) return;
          const list = data.followers || [];
          setFollowers(list);
          setFollowersLoaded(true);
          resolveProfiles(list);
        })
        .catch(() => { if (activePubkeyRef.current === currentPk) setFollowersLoaded(true); });
    }
  }, [activeTab, pubkey, reviewsLoaded, postsLoaded, followingLoaded, followersLoaded]);

  function resolveProfiles(pubkeys: string[]) {
    const toFetch = pubkeys.filter((pk) => !profileCache.current.has(pk));
    if (toFetch.length === 0) return;
    Promise.allSettled(
      toFetch.map((pk) =>
        apiFetch<ProfileData>(`/profiles/${pk}`)
          .then((data) => profileCache.current.set(pk, data))
          .catch(() => profileCache.current.set(pk, { pubkey: pk })),
      ),
    ).then(() => setProfileVersion((v) => v + 1));
  }

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

  const handleMute = async () => {
    if (!pubkey || muteLoading) return;
    setMuteLoading(true);
    try {
      await apiFetch("/moderation/mute", {
        method: "POST",
        body: JSON.stringify({ pubkey }),
      });
      setIsMuted(true);
    } catch {
      // Silently fail
    } finally {
      setMuteLoading(false);
    }
  };

  const handleUnmute = async () => {
    if (!pubkey || muteLoading) return;
    setMuteLoading(true);
    try {
      await apiFetch(`/moderation/mute/${pubkey}`, { method: "DELETE" });
      setIsMuted(false);
    } catch {
      // Silently fail
    } finally {
      setMuteLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0", color: "var(--text-secondary)" }}>
        Loading...
      </div>
    );
  }

  const displayName = profile?.name || truncatePubkey(pubkey || "");
  const bio = profile?.about || "";
  const avatar = profile?.picture || PLACEHOLDER_AVATAR;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "reviews", label: "Reviews", count: reviewsLoaded ? reviews.length : undefined },
    { key: "posts", label: "Posts", count: postsLoaded ? posts.length : undefined },
    { key: "following", label: "Following", count: followingLoaded ? follows.length : undefined },
    { key: "followers", label: "Followers", count: followersLoaded ? followers.length : undefined },
  ];

  // Suppress unused var warnings — these trigger re-renders when caches update
  void profileVersion;
  void gameTitleVersion;

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
      <div style={{ display: "flex", gap: 24, marginBottom: 32, alignItems: "flex-start" }}>
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

        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>{displayName}</h1>
            {/* Action buttons — only if logged in and not own profile */}
            {user && !isOwnProfile && (
              <>
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
                  }}
                >
                  {followLoading ? "..." : isFollowing ? "Unfollow" : "Follow"}
                </button>
                <button
                  onClick={isMuted ? handleUnmute : handleMute}
                  disabled={muteLoading}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "var(--radius)",
                    backgroundColor: "transparent",
                    color: isMuted ? "#e94560" : "var(--text-muted)",
                    fontSize: 12,
                    border: "1px solid var(--border)",
                    opacity: muteLoading ? 0.7 : 1,
                    cursor: muteLoading ? "default" : "pointer",
                  }}
                >
                  {muteLoading ? "..." : isMuted ? "Unmute" : "Mute"}
                </button>
              </>
            )}
          </div>

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

          <p
            style={{
              fontSize: 14,
              color: bio ? "var(--text-secondary)" : "var(--text-muted)",
              lineHeight: 1.6,
              marginBottom: 12,
              fontStyle: bio ? "normal" : "italic",
            }}
          >
            {bio || "No bio yet."}
          </p>

          <div style={{ display: "flex", gap: 24, fontSize: 13, color: "var(--text-muted)" }}>
            {profile?.created_at && (
              <div>
                Member since{" "}
                <span style={{ color: "var(--text-secondary)" }}>{formatDate(profile.created_at)}</span>
              </div>
            )}
            <div>
              <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                {reviewsLoaded ? reviews.length : "..."}
              </span>{" "}
              reviews
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
                <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
                  {reputation.attestationCount}
                </span>{" "}
                {reputation.attestationCount === 1 ? "attestation" : "attestations"}
              </div>
              <div>
                <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
                  {reputation.uniqueAttesters}
                </span>{" "}
                unique {reputation.uniqueAttesters === 1 ? "attester" : "attesters"}
              </div>
            </div>
          </>
        ) : (
          <p style={{ fontSize: 14, color: "var(--text-muted)" }}>No seeding activity yet</p>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid var(--border)" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: activeTab === t.key ? 600 : 400,
              color: activeTab === t.key ? "var(--text-primary)" : "var(--text-muted)",
              borderBottom: activeTab === t.key ? "2px solid var(--accent)" : "2px solid transparent",
              backgroundColor: "transparent",
              cursor: "pointer",
              transition: "all 0.15s",
              marginBottom: -1,
            }}
          >
            {t.label}
            {t.count !== undefined && (
              <span style={{ marginLeft: 6, fontSize: 12, color: "var(--text-muted)" }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "reviews" && (
        <div>
          {!reviewsLoaded ? (
            <p style={{ color: "var(--text-muted)" }}>Loading reviews...</p>
          ) : reviews.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>No reviews yet.</p>
          ) : (
            reviews.map((ev) => {
              let parsed: { rating?: number; title?: string; body?: string } = {};
              try {
                parsed = JSON.parse(ev.content);
              } catch {
                // malformed
              }
              const dTag = (ev.tags as string[][]).find((t) => t[0] === "d");
              const slug = dTag?.[1] || "";
              const gameTitle = gameTitleCache.current.get(slug) || slug;
              return (
                <div
                  key={ev.id}
                  style={{
                    backgroundColor: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-lg)",
                    padding: 16,
                    marginBottom: 12,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <div>
                      <Link
                        to={`/game/${slug}`}
                        style={{ fontSize: 15, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
                      >
                        {gameTitle}
                      </Link>
                      <span style={{ marginLeft: 12, color: "#f5c542", fontSize: 14 }}>
                        {renderStars(parsed.rating || 0)}
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {formatRelativeTime(ev.created_at)}
                    </span>
                  </div>
                  {parsed.title && (
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{parsed.title}</div>
                  )}
                  {parsed.body && (
                    <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 }}>
                      {parsed.body}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === "posts" && (
        <div>
          {!postsLoaded ? (
            <p style={{ color: "var(--text-muted)" }}>Loading posts...</p>
          ) : posts.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>No posts yet.</p>
          ) : (
            posts.map((ev) => (
              <div
                key={ev.id}
                style={{
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-lg)",
                  padding: 16,
                  marginBottom: 12,
                }}
              >
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                  {formatRelativeTime(ev.created_at)}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: "var(--text-primary)",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {ev.content}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "following" && (
        <div>
          {!followingLoaded ? (
            <p style={{ color: "var(--text-muted)" }}>Loading...</p>
          ) : follows.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>Not following anyone yet.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {follows.map((pk) => {
                const p = profileCache.current.get(pk);
                return (
                  <Link
                    key={pk}
                    to={`/profile/${pk}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: 12,
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-lg)",
                      textDecoration: "none",
                      color: "var(--text-primary)",
                    }}
                  >
                    <img
                      src={p?.picture || PLACEHOLDER_AVATAR}
                      alt=""
                      style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = PLACEHOLDER_AVATAR;
                      }}
                    />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                        {p?.name || truncatePubkey(pk)}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                        {truncatePubkey(pk)}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === "followers" && (
        <div>
          {!followersLoaded ? (
            <p style={{ color: "var(--text-muted)" }}>Loading...</p>
          ) : followers.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>No followers yet.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {followers.map((pk) => {
                const p = profileCache.current.get(pk);
                return (
                  <Link
                    key={pk}
                    to={`/profile/${pk}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: 12,
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-lg)",
                      textDecoration: "none",
                      color: "var(--text-primary)",
                    }}
                  >
                    <img
                      src={p?.picture || PLACEHOLDER_AVATAR}
                      alt=""
                      style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = PLACEHOLDER_AVATAR;
                      }}
                    />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                        {p?.name || truncatePubkey(pk)}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                        {truncatePubkey(pk)}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
