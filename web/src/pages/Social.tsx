import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "../api";
import { useAuthStore } from "../stores/authStore";
import { PostCard } from "../components/PostCard";
import { ComposeBox } from "../components/ComposeBox";
import type { NostrEvent, ProfileData } from "../types";

type Tab = "foryou" | "following";

export function Social() {
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<Tab>("foryou");
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const profileCache = useRef<Map<string, ProfileData>>(new Map());
  const [profileVersion, setProfileVersion] = useState(0);
  const followsRef = useRef<string[] | null>(null);

  const resolveProfiles = useCallback(async (pubkeys: string[]) => {
    const unknown = pubkeys.filter((pk) => !profileCache.current.has(pk));
    if (unknown.length === 0) return;

    const results = await Promise.allSettled(
      unknown.map((pk) => apiFetch<ProfileData>(`/profiles/${pk}`))
    );
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        profileCache.current.set(unknown[i], r.value);
      }
    });
    setProfileVersion((v) => v + 1);
  }, []);

  const fetchEvents = useCallback(
    async (until?: number) => {
      let url = `/events?kinds=1&limit=30`;
      if (until) url += `&until=${until}`;

      if (tab === "following") {
        if (!user?.pubkey) return [];
        if (!followsRef.current) {
          try {
            const data = await apiFetch<{ follows: string[] }>(`/follows/${user.pubkey}`);
            followsRef.current = data.follows ?? [];
          } catch {
            followsRef.current = [];
          }
        }
        if (followsRef.current.length === 0) return [];
        url += `&authors=${followsRef.current.join(",")}`;
      }

      const data = await apiFetch<{ events: NostrEvent[] }>(url);
      const fetched = data.events ?? [];
      await resolveProfiles(fetched.map((e) => e.pubkey));
      return fetched;
    },
    [tab, user?.pubkey, resolveProfiles]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEvents([]);
    setHasMore(true);
    followsRef.current = null;

    fetchEvents().then((fetched) => {
      if (cancelled) return;
      setEvents(fetched);
      setHasMore(fetched.length >= 30);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [fetchEvents]);

  async function loadMore() {
    if (loadingMore || events.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = events[events.length - 1].created_at;
      const fetched = await fetchEvents(oldest);
      setEvents((prev) => {
        const existing = new Set(prev.map((e) => e.id));
        return [...prev, ...fetched.filter((e) => !existing.has(e.id))];
      });
      setHasMore(fetched.length >= 30);
    } finally {
      setLoadingMore(false);
    }
  }

  function handleNewPost(event: NostrEvent) {
    setEvents((prev) => [event, ...prev]);
    if (user?.pubkey && !profileCache.current.has(user.pubkey)) {
      profileCache.current.set(user.pubkey, {
        pubkey: user.pubkey,
        name: user.displayName,
      });
      setProfileVersion((v) => v + 1);
    }
  }

  const tabStyle = (t: Tab) => ({
    padding: "8px 20px",
    borderRadius: "var(--radius)",
    backgroundColor: tab === t ? "var(--bg-tertiary)" : "transparent",
    color: tab === t ? "var(--text-primary)" : "var(--text-secondary)",
    fontWeight: tab === t ? 600 : 400,
    fontSize: 14,
    cursor: "pointer" as const,
  });

  // suppress unused warning — profileVersion drives re-renders so cached profiles display
  void profileVersion;

  return (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
        <button style={tabStyle("foryou")} onClick={() => setTab("foryou")}>
          For You
        </button>
        <button style={tabStyle("following")} onClick={() => setTab("following")}>
          Following
        </button>
      </div>

      {user && <ComposeBox onPost={handleNewPost} />}

      {tab === "following" && !user && (
        <div
          style={{
            textAlign: "center",
            padding: 40,
            color: "var(--text-secondary)",
            fontSize: 14,
          }}
        >
          Sign in to see posts from people you follow.
        </div>
      )}

      {tab === "following" && user && !loading && events.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: 40,
            color: "var(--text-secondary)",
            fontSize: 14,
          }}
        >
          You're not following anyone yet. Discover people on the For You tab!
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)" }}>
          Loading...
        </div>
      ) : (
        <>
          {events.map((event) => {
            const profile = profileCache.current.get(event.pubkey);
            return (
              <PostCard
                key={event.id}
                event={event}
                authorName={profile?.name}
                authorPicture={profile?.picture}
              />
            );
          })}

          {!loading && events.length === 0 && tab === "foryou" && (
            <div
              style={{
                textAlign: "center",
                padding: 40,
                color: "var(--text-secondary)",
                fontSize: 14,
              }}
            >
              No posts yet. Be the first to share something!
            </div>
          )}

          {hasMore && events.length > 0 && (
            <div style={{ textAlign: "center", padding: 20 }}>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  padding: "8px 24px",
                  borderRadius: "var(--radius)",
                  backgroundColor: "var(--bg-tertiary)",
                  color: "var(--text-secondary)",
                  fontSize: 14,
                  cursor: loadingMore ? "not-allowed" : "pointer",
                }}
              >
                {loadingMore ? "Loading..." : "Load More"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
