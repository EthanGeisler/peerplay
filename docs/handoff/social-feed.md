# Social Feed — Twitter-like News Feed (2026-03-18)

## What was built

- **`web/src/pages/Social.tsx`** (NEW) — Main feed page with two sub-tabs: For You (all kind 1 events) and Following (filtered by user's follow list). Cursor-based pagination via `until` parameter. Profile resolution with `useRef<Map>` cache + `Promise.allSettled` batch fetching.
- **`web/src/components/PostCard.tsx`** (NEW) — Feed item card: 32px avatar circle + author name (links to `/profile/:pubkey`) + relative timestamp + content. Uses `formatRelativeTime()`.
- **`web/src/components/ComposeBox.tsx`** (NEW) — Textarea + Post button. Submits via `POST /api/events/sign-and-publish` with `{ kind: 1, content, tags: [] }`. Prepends new event to feed on success.
- **`web/src/App.tsx`** (MODIFIED) — Added "Social" to NAV_ITEMS (between Library and About), added `/social` route.
- **`web/src/utils.ts`** (MODIFIED) — Added `formatRelativeTime(unixSeconds)`: returns "just now", "2m ago", "3h ago", "2d ago", or locale date for older.
- **`web/src/types.ts`** (MODIFIED) — Added `ProfileData` interface (consolidated from duplicate in Profile.tsx).
- **`web/src/pages/Profile.tsx`** (MODIFIED) — Removed local `ProfileData` interface, now imports from `../types`.

## No server changes

All endpoints already existed from Phase 4+5. The Social tab is purely a frontend feature.

## Endpoints used

| Endpoint | Purpose |
|---|---|
| `GET /api/events?kinds=1&limit=30` | For You feed (all users) |
| `GET /api/events?kinds=1&authors=<csv>&limit=30&until=<ts>` | Following feed (filtered + paginated) |
| `GET /api/follows/:pubkey` | Get follow list for Following tab |
| `GET /api/profiles/:pubkey` | Resolve author display names/avatars |
| `POST /api/events/sign-and-publish` | Compose new posts (server signs) |

## Key decisions

- **REST-only, no WebSocket subscription.** Simpler for initial implementation. Real-time updates deferred.
- **Profile cache in `useRef<Map>`** instead of `useState<Map>`. Avoids re-renders per profile fetch — a `profileVersion` counter triggers batch re-renders after all profiles resolve.
- **Deduplication on pagination.** `until` may be inclusive, so `loadMore` filters out events whose ID already exists in the current list (Set-based check).
- **Following tab graceful degradation.** Not logged in → "Sign in" prompt. No follows → "Discover people on For You" message.
- **`formatRelativeTime` uses unix seconds** (matching `NostrEvent.created_at`), not milliseconds.

## Deferred features

- Reply count per post (would need server aggregation or N+1 requests)
- Like/reaction button (kind 7 events exist but no UI)
- Inline reply threading
- Real-time updates via WebSocket relay subscription
- Client-side signing in browser (Phase 8 scope)

## How to extend

To add **reactions/likes**: Create a `ReactionButton` component that calls `POST /api/events/sign-and-publish` with `{ kind: 7, content: "+", tags: [["e", eventId]] }`. Query reaction counts via `GET /api/events?kinds=7&#e=<eventId>`.

To add **real-time updates**: Subscribe to the WebSocket relay at `wss://boilerdeck.com/relay` with `["REQ", "feed", { kinds: [1], limit: 0 }]`, then prepend incoming `EVENT` messages to the feed state.

To add **reply threading**: Add a reply button to PostCard that expands an inline ComposeBox with `tags: [["e", parentEventId]]`. Display reply count by querying `GET /api/events/:eventId/replies`.
