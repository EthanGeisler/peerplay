# BoilerDeck Decentralization Plan

> **Status:** Phase 1 COMPLETE (13/13 sub-tasks), Phase 2 in progress (as of 2026-03-18)
> **Guiding principle:** Centralized UX, decentralized plumbing. The gateway is a convenience layer, not a chokepoint.
> **Reviewed by:** Grok (2026-03-17) — critical curve fix (secp256k1), identity immutability, password change flow, self-custody registration path applied.

## Quick Start for New Sessions

**Read order:** `CLAUDE.md` → `CONTEXT.md` → this file → then check `docs/handoff/` for completed sub-task handoffs → start implementing the next sub-task.

**Phase 1 is complete.** All users have secp256k1 keypairs, custody modes, and the full identity system is deployed. Phase 2 (Event Schema & Signing) is in progress.

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

**Goal:** Replace email/password as the *underlying* identity while keeping it as the UX surface. Every account gets backed by a **secp256k1 keypair** (Nostr-compatible). Users don't notice unless they want to.

**Crypto stack:** `@noble/curves` (secp256k1 + Schnorr), `@noble/hashes` (SHA-256), `@scure/bip39` (mnemonics), `@scure/bip32` (NIP-06 key derivation), `@scure/base` (hex/bech32 encoding)

### 1.1 — Add crypto dependencies
- **File:** `server/packages/auth/package.json`
- Add to dependencies:
  - `@noble/curves` ^2.0.0 (secp256k1 + Schnorr signatures)
  - `@noble/hashes` ^2.0.0 (SHA-256 for event hashing)
  - `@scure/bip39` ^2.0.0 (BIP39 mnemonic generation)
  - `@scure/bip32` ^2.0.1 (BIP32 HD key derivation for NIP-06)
  - `@scure/base` ^1.2.0 (hex, bech32 encoding for npub/nsec)
- Run `npm install` from repo root
- **Test:** `npm install` succeeds, no version conflicts
- **Note:** Do NOT use `@noble/ed25519` — Nostr requires secp256k1, not Ed25519

### 1.2 — Crypto utility module
- **File:** `server/packages/auth/src/crypto.ts` (NEW)
- Functions needed:
  - `generateMnemonic()` → 12-word BIP39 mnemonic (english wordlist, imported from `@scure/bip39/wordlists/english.js` — the `.js` extension is required by the package's exports map)
  - `mnemonicToKeypair(mnemonic: string)` → `{ publicKey: Uint8Array, privateKey: Uint8Array }`
    - Derivation path: `m/44'/1237'/0'/0/0` (NIP-06 standard for Nostr)
    - privateKey = 32-byte secp256k1 scalar
    - publicKey = 32-byte x-only pubkey (Schnorr format, NOT compressed 33-byte)
  - `generateKeypair()` → calls generateMnemonic + mnemonicToKeypair, returns `{ mnemonic, publicKey, privateKey }`
  - `encryptPrivateKey(privateKey: Uint8Array, password: string)` → hex string (AES-256-GCM via Node `crypto.scryptSync`)
  - `decryptPrivateKey(encrypted: string, password: string)` → Uint8Array
  - `encryptMnemonic(mnemonic: string, password: string)` → hex string (same AES-256-GCM scheme)
  - `decryptMnemonic(encrypted: string, password: string)` → string
  - `schnorrSign(privateKey: Uint8Array, messageHash: Uint8Array)` → Uint8Array (64-byte Schnorr signature)
  - `schnorrVerify(publicKey: Uint8Array, messageHash: Uint8Array, signature: Uint8Array)` → boolean
  - `pubkeyHex(publicKey: Uint8Array)` → lowercase hex string (32 bytes = 64 hex chars, x-only)
  - `pubkeyToNpub(publicKey: Uint8Array)` → bech32 `npub1...` string
  - `privkeyToNsec(privateKey: Uint8Array)` → bech32 `nsec1...` string
- Encryption format: `v1:salt(32B):nonce(12B):tag(16B):ciphertext` as colon-separated hex segments
  - Version prefix `v1:` allows future format upgrades without breaking existing data
  - scrypt parameters for `v1`: `N=32768 (2^15), r=8, p=1, keyLen=32` — hardcoded as constants tied to the `v1` prefix. Changing these requires a new version prefix (e.g., `v2:`).
- Use `@noble/curves/secp256k1.js` for `schnorr` property (sign/verify) — note the `.js` extension (ESM exports)
- Use `@noble/hashes/sha2.js` for `sha256` — NOT `@noble/hashes/sha256` (doesn't exist)
- Use `@scure/bip32` HDKey for NIP-06 derivation path
- **Test:** Round-trip: generate → encrypt → decrypt → sign → verify. Also: verify npub/nsec bech32 encoding matches known test vectors from NIP-06/NIP-19

### 1.3 — Database migration: add keypair columns to User
- **File:** `server/prisma/schema.prisma`
- Add Prisma enum:
  ```prisma
  enum CustodyMode {
    CUSTODIAL
    SELF_CUSTODY
    @@map("custody_mode")
  }
  ```
- Add to User model:
  ```prisma
  nostrPubkey           String?      @unique @map("nostr_pubkey")
  encryptedNsec         String?      @map("encrypted_nsec")
  encryptedMnemonic     String?      @map("encrypted_mnemonic")
  custodyMode           CustodyMode  @default(CUSTODIAL) @map("custody_mode")
  ```
- `nostrPubkey`: 64-char hex (x-only secp256k1 pubkey). Nullable for backwards compat.
- `encryptedNsec`: private key encrypted with user's password. Nullable (null = self-custody or pre-migration).
- `encryptedMnemonic`: 12-word mnemonic encrypted with user's password. Stored so user can re-display recovery phrase. Nullable (null = self-custody or pre-migration).
- `custodyMode`: Prisma enum, not String. CUSTODIAL = server holds encrypted key. SELF_CUSTODY = user holds key, server only has pubkey.
- Run: `npx prisma migrate dev --name add_keypair_identity`
- **Test:** Migration applies, existing data untouched

### 1.4 — Generate keypair on registration (custodial path)
- **File:** `server/packages/auth/src/service.ts`
- In `register()`, after `db.user.create()`:
  1. `generateKeypair()` → get mnemonic + keypair
  2. `encryptPrivateKey(privateKey, input.password)` → encrypted nsec hex
  3. `encryptMnemonic(mnemonic, input.password)` → encrypted mnemonic hex
  4. `db.user.update()` with `nostrPubkey` (hex), `encryptedNsec`, `encryptedMnemonic`
  5. Add `mnemonic` to return value (one-time display, never stored in plaintext)
- **File:** `server/packages/auth/src/schemas.ts`
- Update `registerSchema` to accept optional `pubkey` field:
  ```ts
  registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    displayName: z.string().min(2).max(50),
    pubkey: z.string().length(64).regex(/^[0-9a-f]+$/).optional(),
  })
  ```
- In `register()`, if `input.pubkey` is provided (self-custody path):
  - Skip server-side keygen entirely
  - Store `nostrPubkey = input.pubkey`, `encryptedNsec = null`, `encryptedMnemonic = null`
  - Set `custodyMode = SELF_CUSTODY`
  - No mnemonic in response (client generated it)
- Return shape: `{ user: { ...existing, nostrPubkey }, accessToken, refreshToken, mnemonic? }`
- **Test:** Register custodial user → pubkey set, mnemonic is 12 words. Register self-custody user with pubkey → no mnemonic, custody mode correct.

### 1.5 — Cache signing key on login
- **File:** `server/packages/auth/src/service.ts`
- In `login()`, after password verification:
  1. If user has `encryptedNsec` (custodial), decrypt it with `input.password`
  2. Store in Redis: `signing_key:{userId}` → AES-256-GCM encrypted with `SIGNING_CACHE_KEY` env var, TTL = refresh token expiry
  3. **Security note:** Redis value is encrypted at rest with a server runtime key (`SIGNING_CACHE_KEY`), not stored as raw hex. If Redis is compromised, attacker still needs the server's memory/env to decrypt.
- **File:** `server/packages/shared/src/config.ts`
- Add `SIGNING_CACHE_KEY` to config (required, 32-byte hex, generated on first deploy)
- **File:** `server/packages/shared/src/middleware.ts`
- Add `pubkey` to JwtPayload interface
- In `generateAccessToken()`, add `pubkey: user.nostrPubkey` to JWT payload
- **Test:** Login, verify Redis key exists (encrypted), JWT contains pubkey

### 1.6 — Lazy keypair migration for existing users
- **File:** `server/packages/auth/src/service.ts`
- In `login()`, if user has no `nostrPubkey`:
  1. Generate keypair + mnemonic
  2. Encrypt privkey and mnemonic with password, store in DB
  3. Add `mnemonic` to login response (one-time)
- **File:** `server/packages/auth/src/routes.ts`
- New route: `POST /api/auth/recover-mnemonic` (authenticated, requires password in body)
  - For users who dismissed the mnemonic modal and need to see it again
  - Decrypts `encryptedMnemonic` with provided password, returns the original 12 words
  - Does NOT generate a new keypair — the pubkey is immutable
  - If `encryptedMnemonic` is null (self-custody user), return 400 with message explaining self-custody users manage their own keys
- **Important:** There is no "regenerate keys" flow. Nostr identities are immutable. Once a pubkey is assigned, it cannot be changed. All signed events are tied to that pubkey forever.
- **Test:** Login with pre-migration user → keypair generated, mnemonic returned. Call recover-mnemonic → same 12 words returned.

### 1.7 — Challenge-based login (sovereign mode)
- **File:** `server/packages/auth/src/routes.ts`
- `GET /api/auth/challenge` → random 32-byte hex, stored in Redis `challenge:{hex}` with 5min TTL
  - **Rate limit:** 10 requests per IP per minute (use express-rate-limit middleware on this route)
- `POST /api/auth/login/pubkey` → body: `{ pubkey, challenge, signature }`
  - Verify challenge exists in Redis and hasn't expired
  - Verify Schnorr signature over SHA-256(challenge bytes) using pubkey
  - Look up user by `nostrPubkey`
  - Issue JWT + refresh token (same as normal login, no password needed)
  - Delete challenge from Redis
- **Test:** Generate keypair locally, request challenge, sign it, get tokens back

### 1.8 — Key export and custody switch
- **File:** `server/packages/auth/src/routes.ts`
- `POST /api/auth/export-keys` (authenticated)
  - Body: `{ password }` — re-auth
  - Decrypt privkey, return `{ privateKey: hex, nsec: bech32, pubkey: hex, npub: bech32 }`
  - Only works for custodial users (self-custody users already have their keys)
- `POST /api/auth/switch-custody` (authenticated)
  - Body: `{ mode: "SELF_CUSTODY", password }` — re-auth
  - Update `custodyMode` to `SELF_CUSTODY`
  - Delete `encryptedNsec` and `encryptedMnemonic` from DB (set to null)
  - Delete `signing_key:{userId}` from Redis
  - **Warning:** This is a one-way operation. User must have exported their keys first. Confirm via response that keys are gone.
- **Test:** Export keys, switch custody, verify privkey and mnemonic deleted from DB

### 1.9 — Frontend: mnemonic display on registration (web)
- **Files:** `web/src/stores/authStore.ts`, `web/src/types.ts`, registration page
- Update `ApiAuthResponse` to include optional `mnemonic?: string`
- Update `ApiUser` to include optional `nostrPubkey?: string`
- On register success, if `mnemonic` present, show modal:
  - "Save your recovery phrase" with 12 words in a grid
  - Copy button, confirmation checkbox "I have saved my recovery phrase"
  - Cannot dismiss without checking the box
  - Escape hatch: "I'll do this later" button that warns "You can recover your phrase from Settings, but if you forget your password, your decentralized identity will be lost"
- Mnemonic never persisted to localStorage

### 1.10 — Frontend: mnemonic display on first login migration (web)
- Same modal flow when login response includes `mnemonic`

### 1.11 — Electron client: mnemonic flow
- **Files:** `client/src/renderer/stores/authStore.ts`, `client/src/renderer/types.ts`
- Mirror web changes

### 1.12 — Electron client: client-side keypair generation (self-custody registration)
- **Files:** `client/src/main/index.ts` (IPC handlers), `client/src/main/preload.ts`
- Add `@noble/curves`, `@scure/bip39`, `@scure/bip32`, `@scure/base` to client dependencies
- IPC: `crypto:generate-keypair` → uses `@noble/curves/secp256k1` + NIP-06 derivation in main process, returns `{ mnemonic, pubkeyHex }`
- IPC: `crypto:sign-challenge` → signs challenge with locally stored private key (Schnorr)
- Registration toggle: "Generate keys on this device (advanced)"
  - When enabled: client generates keypair locally, shows mnemonic, stores encrypted privkey in Electron store
  - Sends `{ email, password, displayName, pubkey: pubkeyHex }` to server (server stores pubkey only, no encrypted key)
- Private key stored in Electron store (encrypted at rest via safeStorage)
- Login flow for self-custody Electron users: use challenge-based login (1.7) instead of password

### 1.13 — Password change flow
- **File:** `server/packages/auth/src/routes.ts`
- `POST /api/auth/change-password` (authenticated)
  - Body: `{ currentPassword, newPassword }`
  - Verify `currentPassword` against stored bcrypt hash
  - If user has `encryptedNsec`:
    1. Decrypt privkey with `currentPassword`
    2. Re-encrypt privkey with `newPassword`
    3. Update `encryptedNsec` in DB
  - If user has `encryptedMnemonic`:
    1. Decrypt mnemonic with `currentPassword`
    2. Re-encrypt mnemonic with `newPassword`
    3. Update `encryptedMnemonic` in DB
  - Hash `newPassword` with bcrypt, update password in DB
  - Invalidate all existing refresh tokens (force re-login on all devices)
  - Delete `signing_key:{userId}` from Redis (will be re-cached on next login)
- **File:** `server/packages/auth/src/schemas.ts`
- Add `changePasswordSchema`:
  ```ts
  changePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  })
  ```
- **Note:** Password reset (forgot password via email) is intentionally NOT supported for custodial users with encrypted keys. If a user forgets their password:
  - They can recover using their mnemonic phrase (import keys into a new account or self-custody client)
  - This is the trade-off of cryptographic identity — the platform cannot reset keys it doesn't hold in plaintext
  - Add a "Forgot password?" link that explains this and offers the mnemonic recovery path
- **Test:** Change password, verify re-encrypted keys still decrypt correctly. Login with new password works. Old refresh tokens invalidated.

---

## Phase 2: Event Schema & Signing

**Goal:** Every piece of user-generated content becomes a signed, portable event. No UX changes — events are created silently alongside existing DB writes.

### Key Design Decisions
- Event ID = SHA-256 hash of canonical JSON (NIP-01 style)
- Canonical JSON: `[0, pubkey, created_at, kind, tags, content]`
- Signatures: Schnorr over secp256k1 (same as Nostr NIP-01)
- Kind ranges: 0-9999 regular, 10000-19999 replaceable, 30000-39999 parameterized replaceable (by `d` tag)
- Custom kinds: 30001 (listing), 30002 (version), 31337 (review), 31338 (attestation)

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
  - `serializeEvent(event)` → NIP-01 canonical JSON: `[0, pubkey, created_at, kind, tags, content]`
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
