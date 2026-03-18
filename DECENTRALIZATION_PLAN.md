# BoilerDeck Decentralization Plan

> **Status:** Phase 1 COMPLETE (archived to `docs/Phase_1_Spec.md`), Phase 2 COMPLETE (11/11), Phase 3 NEXT
> **Guiding principle:** Centralized UX, decentralized plumbing. The gateway is a convenience layer, not a chokepoint.
> **Reviewed by:** Grok (2026-03-17) — critical curve fix (secp256k1), identity immutability, password change flow, self-custody registration path applied.

## Quick Start for New Sessions

**Read order:** `CLAUDE.md` → `CONTEXT.md` → this file → then check `docs/handoff/` for completed sub-task handoffs → start implementing the next sub-task.

**Phases 1 and 2 are complete.** All users have secp256k1 keypairs, custody modes, and the full identity system is deployed. All game operations produce signed Nostr-compatible events. Phase 3 (Relay Infrastructure) is next.

---

## Handoff Documents (Required)

Every sub-task implementation MUST produce a handoff document at `docs/handoff/<sub-task-id>.md` (e.g., `docs/handoff/1.2.md`). This file is the primary way future sessions learn what was built and how to build on top of it.

**Template:**

```markdown
# Sub-task <id> — <title>

## What was built
- Bullet list of files created/modified and what each does

## Key decisions made during implementation
- Why you chose approach X over Y
- Any deviations from the plan and why

## How it works
- Brief explanation of the implementation (enough for someone with zero context to understand)
- Important function signatures, data flows, or architectural patterns introduced

## Gotchas and surprises
- Anything that didn't work as expected
- Version quirks, import path issues, API differences from docs
- Edge cases discovered

## How to use / test
- How to call the new functions or hit the new endpoints
- Example inputs/outputs
- Commands to run verification checks

## What the next sub-task needs to know
- What this sub-task exposes that downstream tasks depend on
- Any unresolved TODOs or known limitations
- Assumptions the next implementer should validate
```

**Rules:**
- Write the handoff BEFORE committing — it's part of the deliverable, not an afterthought
- Be specific: include actual function signatures, actual file paths, actual import statements
- Include code snippets for anything non-obvious
- If you hit a gotcha, explain it thoroughly — the next session will hit the same thing
- Keep it concise but complete — aim for 1-2 pages, not a novel

**Reading handoffs:** Before starting any sub-task, read ALL existing handoff docs in `docs/handoff/` to understand the current state. They accumulate — by sub-task 1.6 you should be reading 1.1 through 1.5's handoffs.

---

## Architecture Summary

- Users get a seamless, centralized-feeling experience by default
- All user actions silently produce decentralized artifacts (signed events, torrents)
- Power users can opt into full sovereignty (self-custody keys, direct relay access, Tor)
- If the gateway goes down, the network survives on relays + BitTorrent swarms
- **Payments:** Stripe stays as default. Crypto/Lightning added as a future phase (after Phase 8)
- **Cryptographic identity:** secp256k1 keypairs (Nostr-compatible, NIP-01/NIP-06), Schnorr signatures

---

## Codebase Snapshot (Post Phase 2 + Refactoring)

### Server Package Layout
```
server/packages/
  auth/src/     → service.ts, routes.ts, schemas.ts, signing.ts, crypto.ts, developer.routes.ts, index.ts
  catalog/src/  → service.ts (game CRUD), upload.ts (zip/exe/Transmission), routes.ts, index.ts
  license/src/  → service.ts, routes.ts, index.ts
  payment/src/  → service.ts, routes.ts, index.ts
  saves/src/    → index.ts
  shared/src/   → config.ts, db.ts, errors.ts (+ handleZodError), index.ts, middleware.ts, redis.ts, stripe.ts,
                   events.ts, eventStore.ts, eventRoutes.ts, eventMaterializer.ts
  torrent/src/  → service.ts, routes.ts, index.ts, vendor.d.ts
```

### Frontend Shared Package
```
shared-ui/src/  → api-core.ts (@boilerdeck/ui-shared: ApiError, createApiClient, TokenStorage)
```
Each frontend's `api.ts` is a thin wrapper providing a `TokenStorage` adapter. See `CLAUDE.md` for conventions.

### Key Types & Signatures You'll Need

**Auth service (`server/packages/auth/src/service.ts`):**
```ts
export async function register(input: RegisterInput)
  // Returns: { user: { id, email, displayName, role }, accessToken, refreshToken }
export async function login(input: LoginInput)
  // Returns: same shape as register
export async function refresh(token: string)
  // Returns: { accessToken, refreshToken }
export async function logout(token: string)
export async function getMe(userId: string)
  // Returns: { id, email, displayName, role, createdAt, developer? }
```

**JWT payload shape (`shared/src/middleware.ts`):**
```ts
interface JwtPayload { sub: string; email: string; role: UserRole; iat: number; exp: number; }
// Phase 1.5 adds: pubkey: string
```

**Auth schemas (`auth/src/schemas.ts`):**
```ts
registerSchema = z.object({ email, password (min 8), displayName (min 2, max 50) })
loginSchema = z.object({ email, password })
```

**Auth routes (`auth/src/routes.ts`):**
```
POST /api/auth/register  → authService.register(input) → 201
POST /api/auth/login     → authService.login(input) → 200
POST /api/auth/refresh   → authService.refresh(refreshToken) → 200
POST /api/auth/logout    → authService.logout(refreshToken) → 200
GET  /api/auth/me        → [authenticate] authService.getMe(req.user.sub) → 200
```

**Shared exports (`shared/src/index.ts`):**
```ts
export { db, redis, getConfig, getStripe }
export { AppError, NotFoundError, UnauthorizedError, ForbiddenError, ConflictError, ValidationError }
export { authenticate, requireRole, errorHandler }
export type { JwtPayload, Env }
```

**Config (`shared/src/config.ts`):**
```
DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET,
JWT_ACCESS_EXPIRES_IN (default "15m"), JWT_REFRESH_EXPIRES_IN (default "7d"),
STRIPE_*, B2_*, TRACKER_URL, PORT (default 3000), NODE_ENV,
CORS_ORIGIN, CORS_ADDITIONAL_ORIGINS, GAMES_DIR, TRANSMISSION_RPC_URL
```

**Redis (`shared/src/redis.ts`):** Uses `ioredis`, exported as `redis` singleton.

**Server entry (`server/src/index.ts`):** Express app, routes mounted at `/api/*`, Helmet with `cross-origin` CORP. To attach WebSocket for Phase 3, use the `http.Server` from `app.listen()`.

**Prisma schema (`server/prisma/schema.prisma`):**
- Models: User, RefreshToken, Developer, Game, GameVersion, Torrent, License, Payment, SaveFile
- Enums: UserRole (PLAYER/DEVELOPER/ADMIN), GameStatus (DRAFT/PENDING_REVIEW/PUBLISHED/SUSPENDED), VersionStatus, LicenseStatus, PaymentStatus
- All models use `@@map("snake_case")` for DB table names
- ESM throughout (`"type": "module"`, `.js` imports)

**Auth package.json deps:** bcrypt, jsonwebtoken, express ^5.1.0, zod, stripe, @boilerdeck/shared

**Frontend types (identical in `web/src/types.ts` and `client/src/renderer/types.ts`):**
```ts
ApiUser { id, email, displayName, role }
ApiAuthResponse { user: ApiUser, accessToken, refreshToken }
ApiGame { id, slug, title, description, priceCents, coverImageUrl, studioName }
ApiGameDetail extends ApiGame { screenshots, exePath, latestVersion, ... }
ApiLicense, ApiTorrent, ApiCheckoutResult, ApiGameListResponse
```
Client also has: InstalledGame, DownloadProgress, Dev* types

---

## Phase 1: Keypair Identity System — COMPLETE

> **13/13 sub-tasks done.** Full specs archived to `docs/Phase_1_Spec.md`. See `docs/handoff/1.1.md` through `docs/handoff/1.13.md` for implementation details.

**Summary:** Every user has a secp256k1 keypair (Nostr-compatible). Custodial users have encrypted privkey/mnemonic in DB. Self-custody users store only pubkey. Signing keys cached in Redis (AES-256-GCM encrypted). Challenge-based login for sovereign mode. Mnemonic modals on registration/login migration. Password change re-encrypts keys. Electron client supports client-side keypair generation.

**Crypto stack:** `@noble/curves` (secp256k1 + Schnorr), `@noble/hashes` (SHA-256), `@scure/bip39` (mnemonics), `@scure/bip32` (NIP-06 key derivation), `@scure/base` (hex/bech32 encoding) — all in `server/packages/auth/`.

**Key files:** `auth/src/crypto.ts` (keypair ops), `auth/src/signing.ts` (server-side event signing), `auth/src/service.ts` (registration/login with keypair generation), `shared/src/middleware.ts` (pubkey in JWT).

---

## Phase 2: Event Schema & Signing

**Goal:** Every piece of user-generated content becomes a signed, portable event. No UX changes — events are created silently alongside existing DB writes.

### Key Design Decisions
- Event ID = SHA-256 hash of canonical JSON (NIP-01 style)
- Canonical JSON: `[0, pubkey, created_at, kind, tags, content]`
  - **NIP-01 serialization rules:** UTF-8 encoded, no whitespace, no trailing commas, `created_at` is an integer (not string), `tags` is an array of arrays of strings, `content` is always a string (JSON-stringify objects before setting as content). The serialized form MUST match byte-for-byte across implementations for the hash to be deterministic.
- Signatures: Schnorr over secp256k1 (same as Nostr NIP-01)
- Kind ranges: 0-9999 regular, 10000-19999 replaceable, 30000-39999 parameterized replaceable (by `d` tag)
- Custom kinds: 30001 (listing), 30002 (version), 31337 (review), 31338 (attestation)
- **Parameterized replaceable events (30000-39999) require a `d` tag.** The `d` tag value is the unique identifier within the `pubkey + kind` namespace. Events without a `d` tag are treated as having `d = ""`. All kind 30001/30002 events MUST include a `d` tag.

**Phase 2 note:** When a sovereign client posts an event directly to a relay (bypassing the gateway), the materializer must handle conflicts with existing DB state. Use `created_at` as tiebreaker — latest event wins. Add a reconciliation script for manual conflict resolution.

### 2.1 — Create events table migration
- **File:** `server/prisma/schema.prisma`
- Add `Event` model:
  ```prisma
  model Event {
    id         String   @id                          // SHA-256 hash of canonical JSON (NIP-01)
    pubkey     String                                // 64-char hex, x-only secp256k1 pubkey
    createdAt  Int      @map("created_at_unix")      // Unix timestamp (seconds)
    kind       Int                                   // Event kind (30001=listing, 30002=version, etc.)
    tags       Json                                  // Array of string arrays (NIP-01)
    content    String                                // Event content (often JSON-stringified)
    sig        String                                // 128-char hex Schnorr signature
    dTag       String?  @map("d_tag")                // Parameterized replaceable event identifier
    receivedAt DateTime @default(now()) @map("received_at")
    @@unique([pubkey, kind, dTag])
    @@index([kind])
    @@index([pubkey])
    @@index([createdAt])
    @@map("events")
  }
  ```
- Add to Game model: `eventId String? @unique @map("event_id")` with relation to Event
- Run migration
- **Test:** Migration applies, existing data untouched, all games have null eventId

### 2.2 — Event utility module
- **File:** `server/packages/shared/src/events.ts` (NEW)
- Export functions:
  - `serializeEvent(event)` → NIP-01 canonical JSON: `[0, pubkey, created_at, kind, tags, content]` — must use `JSON.stringify` with no spaces/indentation and ensure `created_at` is a number, `tags` is `string[][]`, and `content` is a string
  - `hashEvent(event)` → SHA-256 of serialized bytes → hex string (this is the event ID)
  - `createEvent(params: { pubkey, kind, tags, content }, privateKey)` → full signed event with computed `id` and `sig`
  - `verifyEvent(event)` → boolean (recompute hash, verify Schnorr signature)
- Export kind constants: `EVENT_KIND_GAME_LISTING = 30001`, `EVENT_KIND_GAME_VERSION = 30002`, `EVENT_KIND_REVIEW = 31337`, `EVENT_KIND_ATTESTATION = 31338`
- Re-export from `shared/src/index.ts`
- **Test:** Create + verify round-trip. Tamper detection: modifying content, id, or sig → verifyEvent returns false

### 2.3 — Event storage service
- **File:** `server/packages/shared/src/eventStore.ts` (NEW)
- Export functions:
  - `storeEvent(event)` → stores in DB after verifying signature. Returns `STORED` or `DUPLICATE`
  - `getEvent(id)` → fetch single event by ID
  - `queryEvents(filter)` → query by `kinds`, `authors` (pubkeys), `since`, `until`, `limit`
- Replaceable event semantics: for events with same `pubkey + kind + dTag`, only the newest (by `created_at`) is kept
- Invalid signature → reject (don't store)
- Duplicate ID → return `DUPLICATE` (not error)
- **Test:** Store + retrieve, duplicate rejection, invalid sig rejection, replaceable semantics, query by kind/author/limit/since/until

### 2.4 — Server-side signing service
- **File:** `server/packages/auth/src/signing.ts` (NEW)
- Export `signEventForUser(userId, params: { kind, tags, content })` → full signed event
  - Loads encrypted signing key from Redis (`signing_key:{userId}`)
  - Decrypts with `SIGNING_CACHE_KEY`
  - Loads user's pubkey from DB
  - Calls `createEvent()` from shared/events.ts
  - If no Redis key → throw `UnauthorizedError` (user must log in first)
- **Test:** Login user → signEventForUser → verify event. No Redis key → error. Event pubkey matches user's DB pubkey.

### 2.5 — Wrap game creation in event signing
- **File:** `server/packages/catalog/src/service.ts` (or wherever game creation lives)
- After creating a game in DB, also create a kind 30001 event:
  - `content`: JSON-stringified `{ title, description, priceCents, slug }`
  - `tags`: `[["d", slug], ["t", "game"]]`
  - Store event, link `Game.eventId` to the event
- REST response shape unchanged (no breaking changes)
- **Test:** Create game → event exists in DB with correct content/tags. Game.eventId linked. REST response unchanged.

### 2.6 — Wrap game updates and publishing in event signing
- When a game is updated or published, create a new kind 30001 event with updated content
- Replaceable: same `pubkey + kind + dTag(slug)` → replaces previous event
- Publish adds `["status", "PUBLISHED"]` tag
- Update `Game.eventId` to point to newest event
- **Test:** Update game → newer event exists. Only one event per slug per author. Publish → status tag present.

### 2.7 — Wrap game version creation in event signing
- When a game version is uploaded, create a kind 30002 event:
  - `content`: JSON-stringified `{ version, fileSizeBytes, infoHash }`
  - `tags`: `[["d", "<slug>:<version>"], ["e", gameEventId], ["game", slug]]`
- **Test:** Upload version → event exists with correct content and tags. Event verifiable.

### 2.8 — REST endpoint for pre-signed events
- **File:** `server/packages/shared/src/eventRoutes.ts` (NEW)
- `POST /api/events` (authenticated) — submit a pre-signed event
  - Verify signature
  - Verify `event.pubkey` matches authenticated user's pubkey (403 if mismatch)
  - Store event
  - Return 201
- `GET /api/events` (public, no auth required) — query events
  - Query params: `kinds`, `authors`, `limit`, `since`, `until`
  - Returns array of events
- `GET /api/events/:id` (public) — get single event
- Mount routes at `/api/events` in server entry
- **Test:** POST valid event → 201. Bad sig → 400. Pubkey mismatch → 403. GET queries work. POST without auth → 401. GET without auth → 200.

### 2.9 — Event materialization layer
- **File:** `server/packages/shared/src/eventMaterializer.ts` (NEW)
- Export `materializeEvent(event)` — routes events to DB upserts by kind:
  - Kind 30001 → upsert Game row (create or update based on slug in `d` tag)
  - Kind 30002 → upsert GameVersion row
- Idempotent: materializing the same event twice → no error, no duplicate rows
- Called from both `POST /api/events` endpoint AND internal signing flow (2.5-2.7)
- **Test:** Submit kind 30001 event via POST → game row created. REST API reflects materialized data. Idempotent on re-submit.

### 2.10 — Add pubkey to public API responses
- Update `GET /api/auth/me` to include `pubkey` and `custodyMode`
- Update `GET /api/games/:slug` to include developer's `pubkey`
- Update `GET /api/games` to include `eventId` on each game
- All new fields are optional/nullable for backwards compatibility
- **Test:** getMe includes pubkey. Game detail includes developer pubkey. Game list includes eventId. Existing consumers don't break.

### 2.11 — Frontend types and API updates
- **File:** `web/src/types.ts` — add `pubkey?: string`, `custodyMode?: string` to `ApiUser`, `eventId?: string` to `ApiGame`/`ApiGameDetail`
- **File:** `client/src/renderer/types.ts` — matching changes
- Define `Event` type: `{ id, pubkey, created_at, kind, tags, content, sig }`
- **Test:** `npx tsc --noEmit` exits 0 for both web and client

---

## Phase 3: Relay Infrastructure

**Goal:** Gateway becomes a Nostr-compatible relay with WebSocket endpoint. Fully interoperable with existing Nostr clients (Amethyst, Damus, etc.) for our custom event kinds.

**Key new package:** `server/packages/relay/` with WebSocket (ws), NIP-01 protocol, federation.

### 3.1 — Event schema and crypto utilities (relay package)
- **File:** `server/packages/relay/src/crypto.ts` — secp256k1 Schnorr sign/verify (reuses auth/crypto.ts or shared)
- **File:** `server/packages/relay/src/types.ts` — `RelayEvent`, `EventFilter`, `Subscription` interfaces
- Event structure matches NIP-01: `{ id, pubkey, created_at, kind, tags, content, sig }`
- **Test:** Sign + verify round-trip. Tamper detection.

### 3.2 — Prisma schema: events table + user keypair
- Migration for any relay-specific schema additions (if not already covered by 2.1)
- Indexes on `kind`, `pubkey`, `createdAt`, `[kind, createdAt]`
- Verify User model keypair fields from Phase 1 are intact
- **Test:** Insert test event via Prisma, query it back — round-trip succeeds

### 3.3 — Relay package skeleton
- **File:** `server/packages/relay/package.json` — name `@boilerdeck/relay`
- **File:** `server/packages/relay/src/index.ts` — exports service and route modules
- **File:** `server/packages/relay/src/service.ts` — `storeEvent`, `queryEvents`, `deleteEvent`
- **File:** `server/packages/relay/src/routes.ts` — `POST /api/events`, `GET /api/events`, `GET /api/events/:id`
- `npm install` from root resolves `@boilerdeck/relay` as workspace package
- **Test:** REST round-trip: POST event → GET it back by ID → matches

### 3.4 — WebSocket relay endpoint
- **File:** `server/packages/relay/src/ws.ts` — `attachRelayWebSocket(server)`
- **File:** `server/src/index.ts` — create `http.Server` explicitly, call `attachRelayWebSocket(server)`
- NIP-01 protocol messages:
  - `["REQ", subId, filter]` → subscribe to events matching filter
  - `["EVENT", signedEvent]` → publish event
  - `["CLOSE", subId]` → close subscription
  - Server sends: `["EVENT", subId, event]`, `["EOSE", subId]`, `["OK", eventId, success, message]`
- Invalid event rejection → `["OK", eventId, false, "invalid:..."]`
- Nginx config for WebSocket proxy on `/relay`
- **Test:** WS connection accepted. REQ/EVENT flow. Event publishing between clients. OK responses. CLOSE stops subscription.

### 3.5 — Keypair generation on registration + key management
- `POST /api/auth/register` response includes `pubkey` (already done in Phase 1.4)
- Login backfill for users without pubkey (already done in Phase 1.6)
- `GET /api/relay/me/keys` (authenticated) → returns `{ pubkey, privkey }` in hex
- `POST /api/relay/me/import-key` with `{ privkey }` → pubkey updated to match
- Private key encrypted at rest with `EVENT_SIGNING_KEY` env var using AES-256-GCM
- **Test:** Register → pubkey in response. Key export/import works.

### 3.6 — Server-side event signing (for web users)
- `POST /api/events/sign-and-publish` (authenticated) — body: `{ kind, content, tags }`
  - Server signs with user's cached signing key, stores event, broadcasts to WS subscribers
  - Returns full signed event
- **Test:** Sign-and-publish → verifiable event. Pubkey matches user. Event stored. WS subscribers receive it.

### 3.7 — Electron client: relay connection manager
- **File:** `client/src/main/relayManager.ts` — connect/disconnect/subscribe/publish
- IPC channels: `relay:connect`, `relay:disconnect`, `relay:subscribe`, `relay:unsubscribe`, `relay:publish`, `relay:on-event`
- All channels exposed in `preload.ts` and typed in `env.d.ts`
- Auto-reconnect with exponential backoff (1s, 2s, 4s, max 30s)
- Re-sends active subscriptions on reconnect
- **Test:** Electron connects to local relay on startup

### 3.8 — External relay federation (outbound)
- **File:** `server/packages/relay/src/federation.ts`
- Reads `EXTERNAL_RELAYS` env var for relay URLs
- Forwards events authored by local users (pubkeys in User table) to external relays
- Does NOT re-broadcast imported events (loop prevention)
- Reconnects on failure with exponential backoff
- **Test:** Publish event locally → appears on configured external relay

### 3.9 — External relay federation (inbound)
- Import events from external relays that reference local game slugs
- Duplicate handling: same event twice → no error, no duplicate
- Signature verification on import — bad sig → rejected
- Imported events NOT re-forwarded outbound (loop prevention)
- **Test:** Publish on external relay → imported to local DB. Duplicate and bad sig handling.

### 3.10 — Relay discovery endpoint
- `GET /api/relay/info` → JSON with `relay_url`, `name`, `description`, `supported_nips`, `version`
- NIP-11: HTTP GET to `/relay` with `Accept: application/nostr+json` header → relay info document (not WebSocket upgrade)
- External relays list included in info response
- **Test:** REST info endpoint returns valid JSON. NIP-11 header negotiation works.

---

## Phase 4: Social Features

**Goal:** Reviews, comments, follows, and profiles — all as signed events. Users interact socially, and every interaction is a verifiable, portable event.

### 4.1 — Event kind definitions and validation
- **File:** `server/packages/relay/src/kinds.ts`
- Define all kinds: 0 (profile), 1 (text note), 3 (follow list), 5 (deletion), 7 (reaction), 31337 (review), 31338 (attestation)
- Validation functions per kind (required tags, content format)
- Kind 31337 requires `["d", slug]` tag
- Kind 31338 requires `["p", pubkey]` and `["d", identifier]` tags
- **Test:** Valid events pass. Invalid events (missing required tags) rejected with descriptive errors.

### 4.2 — Profile events (kind 0)
- `PUT /api/profiles/me` with `{ name, about, picture }` → creates kind 0 event
- `GET /api/profiles/:pubkey` → returns profile data from latest kind 0 event
- Replaceable: only one kind 0 event per pubkey
- Migration: first profile creation seeds content from existing `displayName`
- **Test:** Set profile, get profile, replaceable semantics, migration from displayName.

### 4.3 — Review events (kind 31337)
- `POST /api/games/:slug/reviews` with `{ rating: 1-5, title, body }` → creates kind 31337 event
- Requires license ownership (403 without)
- `GET /api/games/:slug/reviews` → reviews with rating, title, body, author pubkey, `averageRating`, `reviewCount`
- Parameterized replaceable on `d` tag (one review per user per game)
- **Test:** Submit review, ownership required, get reviews, one per user, aggregation, rating validation.

### 4.4 — Review display UI
- Game detail page (web + client) has "Reviews" section below description
- Average star rating, individual review cards with author, rating, title, body, timestamp
- Pagination via "Load More"
- **Test:** Visual verification with 3+ reviews

### 4.5 — Review submission UI
- `ReviewForm` component in both web and client with star selector, title, body, submit
- "Write a Review" button only visible if user owns game and hasn't reviewed
- Electron client signs review locally and publishes via relay WebSocket (not REST)
- **Test:** Submit review from web UI → appears in list

### 4.6 — Follow list events (kind 3)
- `POST /api/follows` with `{ pubkey }` → creates/updates kind 3 event
- `GET /api/follows/:pubkey` → list of followed pubkeys
- `DELETE /api/follows/:pubkey` → updates kind 3 event, target removed
- Replaceable: single kind 3 event per user, updated atomically
- **Test:** Follow, get follows, unfollow, replaceable.

### 4.7 — User profile page
- Route `/profile/:pubkey` in web and client
- Shows: display name, bio, avatar, member since, review count, follow/unfollow button
- Seeder reputation placeholder (for Phase 5)
- **Test:** Navigate to profile → data renders

### 4.8 — Comment events (kind 1 with tags)
- `POST /api/events/:eventId/replies` with `{ content }` → creates kind 1 event with `["e", parentEventId]` tag
- `GET /api/events/:eventId/replies` → reply events
- Threading: reply to a reply → threaded structure
- Display depth limited to 2-3 levels
- **Test:** Submit reply, get replies, threading works

### 4.9 — Moderation: mute and report
- `POST /api/moderation/mute` with `{ pubkey }` → user's mute list updated
- Muted events filtered from WS subscriptions
- `DELETE /api/moderation/mute/:pubkey` → unmute
- Admin deletion via kind 5 deletion event
- Relay has its own keypair for admin-level deletion events
- **Test:** Mute → events filtered. Unmute → events reappear. Admin delete works.

---

## Phase 5: Seeding Reputation

**Goal:** Peer attestation events for BitTorrent seeding. Users build verifiable reputation by seeding games.

### 5.1 — Attestation event kind (31338) and validation
- Kind 31338 defined with validation rules
- Self-attestation rejected (signer pubkey == `p` tag pubkey → reject)
- Unknown infoHash rejected (referencing non-existent torrent)
- Bytes validation: `bytesDownloaded > torrent file size` → rejected
- Parameterized replaceable: one attestation per (signer, seeder, infoHash)
- **Test:** Valid attestation stored. Self-attestation, unknown infoHash, bad bytes all rejected.

### 5.2 — Electron client: auto-generate attestations after download
- **File:** `client/src/main/attestation.ts`
- `torrentManager.ts` calls attestation generation in `torrent.on("done")` handler
- Attestation includes `infoHash`, `bytesDownloaded`, `durationSeconds`
- `p` tag references VPS seed box pubkey (or swarm attestation)
- **Test:** Complete download → attestation event published to relay

### 5.3 — VPS seed box attestation
- **File:** `scripts/seed-attestation-cron.ts`
- Reads `VPS_SEED_PRIVKEY` env var for signing
- Queries Transmission RPC for completed transfer data
- Publishes attestation events via `POST /api/events`
- **Test:** Run script → attestation events published and verifiable

### 5.4 — Reputation aggregation service
- **File:** `server/packages/relay/src/reputation.ts`
- Score uses logarithmic formula (resists inflation)
- `GET /api/reputation/:pubkey` → score, `attestationCount`, `uniqueAttesters`
- Redis caching (15 min TTL)
- Anti-sybil: accounts < 7 days old weighted at 0.1x, max 20 attestations per attester per day
- **Test:** 5 attestations from 3 unique pubkeys → non-zero score. Zero attestations → zero. Cache hit on second request.

### 5.5 — Reputation display in UI
- Profile page shows "Seeder Score"
- Game detail page shows "Top Seeders" section
- Badge system: Bronze (>=10), Silver (>=50), Gold (>=200)
- **Test:** Profile with attestations shows score and badge

### 5.6 — Web of trust weighting
- `GET /api/reputation/:pubkey?viewer=<viewerPubkey>` → personalized score
- Follow weighting: attestation from followed user = 1.0x, unknown = 0.25x
- Muted = 0x weight
- No viewer specified → global (unweighted) score
- **Test:** Personalized vs global scores differ. Follow and mute weighting works.

---

## Phase 6: Privacy Layer

**Goal:** Tor/SOCKS5 support in Electron client. No server changes needed.

### 6.1 — Privacy settings store schema and IPC
- `StoreData` interface includes `privacySettings: { enabled, mode, socksHost, socksPort, routeApiTraffic, routeTorrentTraffic }`
- `"privacySettings"` in `STORE_KEY_WHITELIST`
- IPC channels: `privacy:get-status`, `privacy:test-connection`
- Preload bridge and `env.d.ts` updated
- **Test:** Store round-trip for privacy settings

### 6.2 — SOCKS5 proxy module for HTTP traffic
- **File:** `client/src/main/proxyManager.ts` — `getProxyAgent`, `testProxyConnection`
- Uses `socks-proxy-agent` package
- `privacy:test-connection` IPC handler wired up
- **Test:** Valid proxy → success. Invalid proxy → failure (not crash).

### 6.3 — Route API traffic through proxy
- IPC channel `api:proxied-fetch` in main process
- Preload exposes `window.boilerdeck.api.fetch`
- Renderer's `apiFetch` checks privacy mode, routes through IPC when enabled
- **Test:** Privacy on → API calls through proxy. Privacy off → direct.

### 6.4 — Route BitTorrent traffic through SOCKS5
- `torrentManager.ts` accepts privacy config, disables `dht`, `lsd`, `webSeeds` in privacy mode
- Warning about reduced speed in code/UI
- **Test:** Privacy mode download completes. No DHT when privacy enabled.

### 6.5 — Tor binary bundling and management
- **File:** `client/src/main/torManager.ts` — `startTor`, `stopTor`, `isTorRunning`, `getTorStatus`
- `electron-builder` config includes `tor.exe` as `extraResource`
- Graceful shutdown on `app.on("before-quit")`
- Tor data directory in app userData (not temp)
- **Test:** Set mode to "tor" → Tor spawns, SOCKS5 port 9150 reachable. Stop → port closed.

### 6.6 — Privacy settings UI page
- Settings page "Privacy & Network" section
- Toggle for Private Mode, radio group (Tor/Custom SOCKS5/Off)
- Custom SOCKS5 shows host/port fields
- "Route API traffic" and "Route torrent traffic" checkboxes
- "Test Connection" button with status indicator
- Tor bootstrap progress display
- **Test:** Toggle on/off → settings persist across restart

### 6.7 — Gateway .onion endpoint documentation
- `ONION_ADDRESS` config option in server config
- `docs/privacy.md` with Tor hidden service setup instructions
- Client uses `.onion` address when in Tor mode (if configured)

---

## Phase 7: Content Generalization

**Goal:** Transform from game-only to multi-content marketplace. Game → Listing, support video/software/audio. `@@map("games")` keeps DB table names — must update every Prisma query and TypeScript type.

### 7.1 — Schema: add content type and generic metadata
- Add `ContentType` enum: `GAME`, `VIDEO`, `SOFTWARE`, `AUDIO`, `OTHER`
- Add to Game model: `contentType ContentType @default(GAME)`, `metadata Json @default("{}")`
- Existing games get `contentType: GAME` after migration
- **Test:** Migration applies cleanly. Existing games have GAME content type.

### 7.2 — Schema: rename Game to Listing
- Prisma model renamed from `Game` to `Listing` with `@@map("games")` preserved
- `GameVersion` → `ListingVersion`, `GameStatus` → `ListingStatus` with `@@map` preserved
- No SQL migration needed (table names unchanged)
- Find-and-replace `db.game.` → `db.listing.` across all server packages
- **Test:** All packages compile. All existing REST endpoints still work.

### 7.3 — Server: generalize catalog service
- Service functions accept `contentType` parameter
- `createListing` accepts `contentType` and `metadata`
- Old function names exist as aliases (backwards compat)
- **Test:** Create non-game listing succeeds. Filter by content type works.

### 7.4 — Server: generalize catalog routes
- `GET /api/listings` returns published listings
- `GET /api/listings?contentType=GAME` returns same as `GET /api/games`
- `POST /api/developer/listings` with `contentType` in body
- Old `/games` routes still work (call same service with `contentType: 'GAME'`)
- **Test:** New routes work. Old routes still work.

### 7.5 — Server: generalize upload pipeline
- Exe detection skipped for non-GAME content types
- File type validation based on `contentType`
- **Test:** Video upload as VIDEO succeeds. Game upload unchanged.

### 7.6 — Server: generalize license and torrent services
- Acquire license for non-game listing → succeeds
- Download torrent for non-game listing → succeeds
- Internal references renamed from "game" to "listing" in code (not DB)

### 7.7 — Server: creator portal role generalization
- "Developer" rebranded to "Creator" in UI text only
- `DEVELOPER` enum value unchanged in DB/schema

### 7.8 — Client: generalize types and stores
- `ApiListing` type with `contentType` field
- Type-specific metadata types: `GameMetadata`, `VideoMetadata`, `SoftwareMetadata`
- Old type names kept as aliases
- **Test:** TypeScript compiles for client

### 7.9 — Client: content-type-aware detail page
- Detail page renders differently based on `contentType`
- GAME: existing game UI (install, launch)
- VIDEO: video player or download button
- Route `/listing/:slug` with `/game/:slug` redirect
- **Test:** Game detail unchanged. Video detail shows video-specific UI.

### 7.10 — Client: video playback with sequential download
- Sequential downloading enabled for VIDEO content type
- IPC: `media:get-file-path` returns local file path
- IPC: `media:start-server` returns localhost URL for streaming
- **Test:** Download and play a video in Electron

### 7.11 — Client + web + dev-portal: UI generalization
- Store page has category tabs/filters: All, Games, Videos, Software, Audio
- Dev-portal "Create Game" → "Create Listing" with content type selector
- "Developer Dashboard" → "Creator Dashboard" in UI text
- **Test:** Filter by content type → correct results. TypeScript compiles for all frontends.

### 7.12 — Dev-portal: generalize upload flow
- Content type selector at top of listing editor form
- Conditional fields based on content type (exe path for games, video file for videos)
- API calls use `/developer/listings` routes
- **Test:** Create VIDEO listing from creator portal with .mp4 upload

---

## Phase 8: Progressive Decentralization

**Goal:** Open relay protocol, federation, sovereign mode. Users can run their own relays and interact without the gateway.

### 8.1 — Cryptographic identity: key generation and storage
- **File:** `client/src/main/keyManager.ts` — keypair generation, signing, import/export
- `"keyPair"` in `STORE_KEY_WHITELIST`
- IPC: `keys:generate`, `keys:get-public-key`, `keys:sign`, `keys:import-mnemonic`, `keys:export-mnemonic`
- Private key encrypted at rest with user passphrase via scrypt + AES
- **Test:** Generate + sign + verify. Mnemonic round-trip → same public key.

### 8.2 — Key management UI in client
- Settings "Identity & Keys" section
- No key: "Generate Identity" button → shows 12-word mnemonic with backup checkbox
- Key exists: truncated pubkey, export/import options
- **Test:** Generate identity in UI → mnemonic shown

### 8.3 — Server: relay protocol — listing metadata API
- Routes: `/relay/listings`, `/relay/listings/:id`, `/relay/info`, `/relay/creators`
- `POST /api/relay/listings` with signed listing → accepted and stored
- Unsigned listing submission → rejected
- **Test:** GET relay listings works. POST signed listing accepted. Unsigned rejected.

### 8.4 — Schema: add relay/signature fields
- `Listing` model gets `creatorPublicKey String?` and `signature String?`
- `Relay` model: `id`, `url`, `name`, `lastSyncAt`, `status`, `trustedByDefault`
- `FederatedListing` model (separate from local listings)
- Existing listings have null `creatorPublicKey` (pre-signing era)
- **Test:** Migration applies. Existing data intact.

### 8.5 — Server: federation — subscribing to external relays
- **File:** `server/packages/relay/src/federation.ts` — inbound federation
- Reads `FEDERATED_RELAYS` env var
- Signature verification on imported listings
- Admin API: `POST /admin/relays`, `DELETE /admin/relays/:id`, `GET /admin/relays`
- **Test:** Two server instances → listings propagate. Sig verification on import.

### 8.6 — Client: relay management UI
- Relay list page showing configured relays with status
- "Add Relay" validates URL by fetching `/relay/info`
- Default relay `boilerdeck.com` always present, cannot be removed
- Relay list stored in Electron store under `relays`
- **Test:** Add relay by URL → appears in list with status

### 8.7 — Client: multi-relay listing aggregation
- Sovereign mode: store fetches from all enabled relays
- Deduplication: same listing from two relays → shows once
- Signature verification in renderer before displaying
- Relay source badge on each listing
- **Test:** Two relays with overlapping listings → no duplicates

### 8.8 — Relay server: open-source packaging
- **Dir:** `relay-server/` at repo root with `src/index.ts`, `prisma/schema.prisma`, `Dockerfile`, `README.md`
- No auth/payment/license code — only listing metadata + federation
- MIT license
- **Test:** `docker build` succeeds. `docker run` → `/relay/info` returns valid response.

### 8.9 — Documentation: running your own relay
- `docs/relay-guide.md` — system requirements, Docker instructions, env config, nginx example, systemd service, Tor hidden service

### 8.10 — Client: sovereign mode toggle
- Settings toggle: "Sovereign Mode" on/off
- ON: store aggregates from all relays, gateway treated as just another relay
- OFF (default): all API calls through gateway
- Warning text about features unavailable in sovereign mode
- `settings.sovereignMode` in Electron store
- **Test:** Toggle sovereign mode → store fetches change source

### 8.11 — Resilience: graceful gateway-down handling
- Gateway failure → client shows banner, falls back to relay data
- Locally installed content always accessible regardless of network
- Cached listing data in Electron store for offline browsing
- Torrent downloads continue without gateway (P2P)
- **Test:** Kill gateway → client shows banner, falls back. Installed games still launch.

### 8.12 — App distribution via BitTorrent
- **File:** `scripts/create-installer-torrent.mjs`
- Generates `.torrent` file for Electron installer
- Concept documented for `APP_UPDATE` listing type
- **Test:** Torrent downloadable via standard client → installer works

### 8.13 — Signed listing publishing flow (end-to-end)
- Full flow: Creator publishes in Electron → signed locally → submitted to gateway → forwarded to federated relays
- Any client can fetch from any relay and verify the signature
- Creator pubkey registered in `users` table and relay creator list
- Listing's `signature` and `creatorPublicKey` fields non-null in DB
- **Test:** End-to-end signing, federation, and verification

---

## Execution Order

```
Phase 1 (Identity) ✅ → Phase 2 (Events) → Phase 3 (Relay) → Phases 4+5 (Social+Reputation)
Phase 6 (Privacy) can run parallel with 3-5
Phase 7 (Generalization) can run parallel with 3-5
Phase 8 (Decentralization) depends on 3+7
```

---

## Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Password change breaks encrypted privkey | 1.13 re-encrypts privkey + mnemonic with new password during change flow |
| Password reset (forgot password) | Not supported for custodial users — mnemonic is the recovery path. Documented in UX. |
| Redis signing key compromised | Encrypted at rest with SIGNING_CACHE_KEY (runtime env var), not raw hex |
| Redis signing key expires mid-session | Refresh TTL on every token refresh; clear error prompting re-login |
| Event table / legacy table drift | DB transactions; reconciliation script |
| Sovereign client event conflicts | Materializer uses `created_at` tiebreaker; reconciliation script for manual cases |
| Prisma rename (Game → Listing) in Phase 7 | Dedicated sub-task, update all queries + types, `@@map("games")` keeps DB table |
| Encryption format changes | Version prefix `v1:` in encryption format allows migration to new schemes |
| Relay federation consistency | External relays may be unreliable, slow, or return stale data. Federation is best-effort — the gateway relay is authoritative. Client deduplicates and prefers newest `created_at`. |
| Phase 7 rename blast radius | Game → Listing rename touches every server package. Run full `tsc --noEmit` + integration smoke tests after each sub-task, not just at the end. |

---

## Grok Review Decisions (2026-03-17)

Items from Grok's review and how they were resolved:

| Issue | Resolution |
|-------|-----------|
| **CRITICAL: Wrong curve (Ed25519)** | Fixed → secp256k1 + Schnorr via `@noble/curves`. NIP-06 derivation path. Full Nostr compatibility. |
| **CRITICAL: Pubkey replacement destroys identity** | Fixed → pubkey is immutable. `recover-mnemonic` route decrypts stored mnemonic. No key regeneration. |
| **CRITICAL: Password change flow missing** | Fixed → added 1.13 with re-encryption of privkey + mnemonic. Password reset intentionally unsupported (mnemonic is recovery). |
| **CRITICAL: Self-custody registration undefined** | Fixed → `registerSchema` accepts optional `pubkey`. Server skips keygen, stores pubkey only. Electron 1.12 updated. |
| **MAJOR: Redis plaintext privkeys** | Fixed → encrypted at rest with `SIGNING_CACHE_KEY` env var. Not raw hex. |
| **MAJOR: Web frontend crypto missing** | Deferred to Phase 8 — web sovereign mode is future. Noble libs work in browser with zero changes when needed. |
| **MAJOR: Lazy migration two identity classes** | No change needed — new users get keys at registration (1.4), existing users at first login (1.6). Temporary migration period, not a permanent split. |
| **MEDIUM: Encryption format version byte** | Fixed → format is `v1:salt:nonce:tag:ciphertext` with version prefix. |
| **MEDIUM: No rate limit on /auth/challenge** | Fixed → 10 req/IP/min via express-rate-limit. |
| **MEDIUM: custodyMode as String** | Fixed → Prisma enum `CustodyMode`. |
| **MEDIUM: Phase 2 sovereign event conflicts** | Added note to Phase 2 about materializer conflict resolution. |
| **MEDIUM: Phase 7 rename scope** | Added note to Phase 7 about updating all queries + types. |
| **MEDIUM: Shared exports for crypto types** | Will be handled in each sub-task as types are created. |
| **MEDIUM: Mnemonic modal escape hatch** | Fixed → "I'll do this later" button with warning added to 1.9. |

### Grok Review #2 Decisions (2026-03-17)

Second round of Grok feedback on Phases 2-8:

| Issue | Resolution |
|-------|-----------|
| **Import paths (.js suffix wrong)** | Disagree — `.js` suffix is required for ESM subpath exports. Already documented on line 202. Grok is incorrect here. |
| **NIP-01 canonical serialization rules** | Agreed — added explicit serialization rules (UTF-8, no whitespace, integer types, string content) to Phase 2 key decisions and 2.2 spec. |
| **Parameterized replaceable d-tag requirement** | Agreed — added explicit note that kinds 30001/30002 MUST include a `d` tag. Already present in 2.5/2.7 examples but now stated as a rule. |
| **Custom kinds 31337/31338 collision risk** | No change — these are in the 30000-39999 app-specific range. Collision with standard Nostr kinds is unlikely and can be renumbered if needed. |
| **Relay federation realism** | Agreed — added risk row noting federation is best-effort, gateway is authoritative. |
| **Tor bundling concerns (legal, size)** | Acknowledged but deferred — Phase 6 is far out. Will evaluate Tor Expert Bundle vs full bundle vs proxy-only at implementation time. |
| **Phase 7 rename smoke tests** | Agreed — added risk row requiring `tsc --noEmit` + integration smoke tests after each Phase 7 sub-task. |
| **Redis TTL / challenge signing nits** | Already addressed in implementation — Redis TTL matches refresh token expiry, challenge signing uses SHA-256(challenge bytes). |
