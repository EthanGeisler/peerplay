# BoilerDeck Decentralization Plan

> **Status:** Planning complete, Phase 1 implementation not yet started (as of 2026-03-17)
> **Guiding principle:** Centralized UX, decentralized plumbing. The gateway is a convenience layer, not a chokepoint.

## Quick Start for New Sessions

**Read order:** `CLAUDE.md` → `CONTEXT.md` → this file → then start implementing from Phase 1.1

**No code has been written for this plan yet.** The existing codebase is a fully functional centralized game distribution platform. This plan transforms it into a hybrid centralized/decentralized media marketplace.

---

## Architecture Summary

- Users get a seamless, centralized-feeling experience by default
- All user actions silently produce decentralized artifacts (signed events, torrents)
- Power users can opt into full sovereignty (self-custody keys, direct relay access, Tor)
- If the gateway goes down, the network survives on relays + BitTorrent swarms
- **Payments:** Stripe stays as default. Crypto/Lightning added as a future phase (after Phase 8)

---

## Codebase Snapshot (Pre-Implementation)

### Server Package Layout
```
server/packages/
  auth/src/     → service.ts, routes.ts, schemas.ts, developer.routes.ts, index.ts
  catalog/src/  → service.ts, routes.ts, index.ts
  license/src/  → service.ts, routes.ts, index.ts
  payment/src/  → service.ts, routes.ts, index.ts
  saves/src/    → index.ts
  shared/src/   → config.ts, db.ts, errors.ts, index.ts, middleware.ts, redis.ts, stripe.ts
  torrent/src/  → service.ts, routes.ts, index.ts, vendor.d.ts
```

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

## Phase 1: Keypair Identity System

**Goal:** Replace email/password as the *underlying* identity while keeping it as the UX surface. Every account gets backed by an Ed25519 keypair. Users don't notice unless they want to.

### 1.1 — Add crypto dependencies
- **File:** `server/packages/auth/package.json`
- Add to dependencies: `@noble/ed25519`, `@noble/hashes`, `@scure/bip39`, `@scure/base`
- Run `npm install` from repo root
- **Test:** `npm install` succeeds, no version conflicts

### 1.2 — Crypto utility module
- **File:** `server/packages/auth/src/crypto.ts` (NEW)
- Functions needed:
  - `generateMnemonic()` → 12-word BIP39 mnemonic
  - `mnemonicToKeypair(mnemonic: string)` → `{ publicKey: Uint8Array, privateKey: Uint8Array }`
  - `generateKeypair()` → calls generateMnemonic + mnemonicToKeypair, returns both
  - `encryptPrivateKey(privateKey: Uint8Array, password: string)` → hex string (AES-256-GCM via Node `crypto.scryptSync`)
  - `decryptPrivateKey(encrypted: string, password: string)` → Uint8Array
  - `signMessage(privateKey: Uint8Array, message: Uint8Array)` → Uint8Array (Ed25519 signature)
  - `verifySignature(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array)` → boolean
  - `pubkeyHex(publicKey: Uint8Array)` → lowercase hex string (32 bytes = 64 hex chars)
- Encryption format: `salt(32B) || nonce(12B) || tag(16B) || ciphertext` all as single hex string
- Use `@noble/ed25519` with `@noble/hashes/sha512` for the SHA-512 context (noble/ed25519 needs it)
- **Test:** Round-trip: generate → encrypt → decrypt → sign → verify

### 1.3 — Database migration: add keypair columns to User
- **File:** `server/prisma/schema.prisma`
- Add to User model:
  ```prisma
  pubkey            String?   @unique
  encryptedPrivateKey String? @map("encrypted_private_key")
  custodyMode       String    @default("CUSTODIAL") @map("custody_mode")
  ```
- All nullable for backwards compat with existing users
- Run: `npx prisma migrate dev --name add_keypair_identity`
- **Test:** Migration applies, existing data untouched

### 1.4 — Generate keypair on registration
- **File:** `server/packages/auth/src/service.ts`
- In `register()`, after `db.user.create()`:
  1. `generateKeypair()` → get mnemonic + keypair
  2. `encryptPrivateKey(privateKey, input.password)` → encrypted hex
  3. `db.user.update()` with `pubkey` (hex) and `encryptedPrivateKey`
  4. Add `mnemonic` to return value (one-time display, never stored)
- Return shape changes: `{ user: { ...existing, pubkey }, accessToken, refreshToken, mnemonic }`
- **Test:** Register user, verify pubkey set, mnemonic is 12 words

### 1.5 — Cache signing key on login
- **File:** `server/packages/auth/src/service.ts`
- In `login()`, after password verification:
  1. If user has `encryptedPrivateKey`, decrypt it with `input.password`
  2. Store in Redis: `signing_key:{userId}` → hex of private key, TTL = refresh token expiry
- **File:** `server/packages/shared/src/middleware.ts`
- Add `pubkey` to JwtPayload interface
- In `generateAccessToken()`, add `pubkey: user.pubkey` to JWT payload
- **Test:** Login, verify Redis key exists, JWT contains pubkey

### 1.6 — Lazy keypair migration for existing users
- **File:** `server/packages/auth/src/service.ts`
- In `login()`, if user has no `pubkey`:
  1. Generate keypair, encrypt with password, store in DB
  2. Add `mnemonic` to login response (one-time)
- **File:** `server/packages/auth/src/routes.ts`
- New route: `POST /api/auth/migrate-keys` (authenticated, requires password in body)
  - For users who dismissed the mnemonic prompt and need it again
  - Re-generates keypair or re-derives mnemonic? No — mnemonic can't be re-derived from encrypted key
  - This route generates a NEW keypair, replaces old, returns new mnemonic
- **Test:** Login with pre-migration user, keypair generated, mnemonic returned

### 1.7 — Challenge-based login (sovereign mode)
- **File:** `server/packages/auth/src/routes.ts`
- `GET /api/auth/challenge` → random 32-byte hex, stored in Redis `challenge:{hex}` with 5min TTL
- `POST /api/auth/login/pubkey` → body: `{ pubkey, challenge, signature }`
  - Verify challenge exists in Redis and hasn't expired
  - Verify signature over challenge bytes using pubkey
  - Look up user by pubkey
  - Issue JWT + refresh token (same as normal login, no password needed)
  - Delete challenge from Redis
- **Test:** Generate keypair locally, request challenge, sign it, get tokens back

### 1.8 — Key export and custody switch
- **File:** `server/packages/auth/src/routes.ts`
- `POST /api/auth/export-keys` (authenticated)
  - Body: `{ password }` — re-auth
  - Decrypt privkey, return `{ privateKey: hex, pubkey: hex }`
- `POST /api/auth/switch-custody` (authenticated)
  - Body: `{ mode: "SELF_CUSTODY", password }` — re-auth
  - Update `custodyMode` to "SELF_CUSTODY"
  - Delete `encryptedPrivateKey` from DB
  - Delete `signing_key:{userId}` from Redis
- **Test:** Export keys, switch custody, verify privkey deleted from DB

### 1.9 — Frontend: mnemonic display on registration (web)
- **Files:** `web/src/stores/authStore.ts`, `web/src/types.ts`, registration page
- Update `ApiAuthResponse` to include optional `mnemonic?: string`
- On register success, if `mnemonic` present, show modal:
  - "Save your recovery phrase" with 12 words in a grid
  - Copy button, confirmation checkbox "I have saved my recovery phrase"
  - Cannot dismiss without checking the box
- Mnemonic never persisted to localStorage

### 1.10 — Frontend: mnemonic display on first login migration (web)
- Same modal flow when login response includes `mnemonic`

### 1.11 — Electron client: mnemonic flow
- **Files:** `client/src/renderer/stores/authStore.ts`, `client/src/renderer/types.ts`
- Mirror web changes

### 1.12 — Electron client: client-side keypair generation
- **Files:** `client/src/main/index.ts` (IPC handlers), `client/src/main/preload.ts`
- IPC: `crypto:generate-keypair` → uses same noble/ed25519 in main process
- IPC: `crypto:sign-message` → signs with locally stored private key
- Registration toggle: "Generate keys on this device (advanced)"
- Private key stored in Electron store (encrypted at rest)
- Server only receives pubkey, no encrypted privkey

---

## Phase 2: Event Schema & Signing

**Goal:** Every piece of user-generated content becomes a signed, portable event. No UX changes — events are created silently alongside existing DB writes.

### Key Design Decisions
- Event ID = SHA-256 hash of canonical JSON (NIP-01 style)
- Canonical JSON: `[0, pubkey, created_at, kind, tags, content]`
- Kind ranges: 0-9999 regular, 10000-19999 replaceable, 30000-39999 parameterized replaceable (by `d` tag)
- Custom kinds: 30001 (listing), 30002 (version), 31337 (review), 31338 (attestation)

### Sub-tasks: 2.1-2.11
See full plan in transcript. Key new files:
- `server/packages/shared/src/events.ts` — serializeEvent, hashEvent, createEvent, verifyEvent
- `server/packages/shared/src/eventStore.ts` — storeEvent, getEvent, queryEvents
- `server/packages/auth/src/signing.ts` — signEventForUser (loads key from Redis)
- `server/packages/shared/src/eventRoutes.ts` — POST/GET /api/events
- `server/packages/shared/src/eventMaterializer.ts` — routes events to DB upserts by kind

---

## Phase 3: Relay Infrastructure

**Goal:** Gateway becomes a Nostr-compatible relay with WebSocket endpoint.

Key new package: `server/packages/relay/` with ws (WebSocket), NIP-01 protocol, federation.

---

## Phases 4-8: Summary

| Phase | What | Depends On |
|-------|------|-----------|
| 4: Social Features | Reviews, comments, follows, profiles — all as signed events | 3 |
| 5: Seeding Reputation | Peer attestation events for BitTorrent seeding | 3 |
| 6: Privacy Layer | Tor/SOCKS5 in Electron client (no server changes) | Independent |
| 7: Content Generalization | Game → Listing, support video/software/audio | Independent |
| 8: Progressive Decentralization | Open relay protocol, federation, sovereign mode | 3, 7 |

---

## Execution Order

```
Phase 1 (Identity) → Phase 2 (Events) → Phase 3 (Relay) → Phases 4+5 (Social+Reputation)
Phase 6 (Privacy) can run parallel with 3-5
Phase 7 (Generalization) can run parallel with 3-5
Phase 8 (Decentralization) depends on 3+7
```

---

## Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Password change breaks encrypted privkey | Re-encrypt privkey during password change flow |
| Redis signing key expires mid-session | Refresh TTL on every token refresh; clear error prompting re-login |
| Event table / legacy table drift | DB transactions; reconciliation script |
| Prisma rename (Game → Listing) in Phase 7 | Dedicated sub-task, find/replace only, `@@map("games")` keeps DB table |

---

## Full Detailed Plan

The complete phase-by-phase plan with all sub-tasks is preserved in the planning transcript:
`C:\Users\eface\.claude\projects\C--Users-eface\93cb9d45-bacc-41ea-827d-b5444a109d4a.jsonl`

The user's original prompt contains the full master plan — it can be pasted again to restore full context.
