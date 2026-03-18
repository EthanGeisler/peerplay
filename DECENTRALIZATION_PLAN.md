# BoilerDeck Decentralization Plan

> **Status:** Planning complete, Phase 1 implementation not yet started (as of 2026-03-17)
> **Guiding principle:** Centralized UX, decentralized plumbing. The gateway is a convenience layer, not a chokepoint.
> **Reviewed by:** Grok (2026-03-17) — critical curve fix (secp256k1), identity immutability, password change flow, self-custody registration path applied.

## Quick Start for New Sessions

**Read order:** `CLAUDE.md` → `CONTEXT.md` → this file → then check `docs/handoff/` for completed sub-task handoffs → start implementing the next sub-task.

**No code has been written for this plan yet.** The existing codebase is a fully functional centralized game distribution platform. This plan transforms it into a hybrid centralized/decentralized media marketplace.

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

### Sub-tasks: 2.1-2.11
See full plan in transcript. Key new files:
- `server/packages/shared/src/events.ts` — serializeEvent, hashEvent, createEvent, verifyEvent
- `server/packages/shared/src/eventStore.ts` — storeEvent, getEvent, queryEvents
- `server/packages/auth/src/signing.ts` — signEventForUser (loads encrypted key from Redis, decrypts with SIGNING_CACHE_KEY, signs)
- `server/packages/shared/src/eventRoutes.ts` — POST/GET /api/events
- `server/packages/shared/src/eventMaterializer.ts` — routes events to DB upserts by kind

**Phase 2 note:** When a sovereign client posts an event directly to a relay (bypassing the gateway), the materializer must handle conflicts with existing DB state. Use `created_at` as tiebreaker — latest event wins. Add a reconciliation script for manual conflict resolution.

---

## Phase 3: Relay Infrastructure

**Goal:** Gateway becomes a Nostr-compatible relay with WebSocket endpoint.

Key new package: `server/packages/relay/` with ws (WebSocket), NIP-01 protocol, federation.

Because we use secp256k1 + Schnorr + NIP-01 canonical JSON, our relay will be fully interoperable with existing Nostr clients (Amethyst, Damus, etc.) for our custom event kinds. Standard Nostr clients can subscribe to and verify our events.

---

## Phases 4-8: Summary

| Phase | What | Depends On |
|-------|------|-----------|
| 4: Social Features | Reviews, comments, follows, profiles — all as signed events | 3 |
| 5: Seeding Reputation | Peer attestation events for BitTorrent seeding | 3 |
| 6: Privacy Layer | Tor/SOCKS5 in Electron client (no server changes) | Independent |
| 7: Content Generalization | Game → Listing, support video/software/audio. `@@map("games")` keeps DB table — must update every Prisma query and TypeScript type | Independent |
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

---

## Full Detailed Plan

The complete phase-by-phase plan with all sub-tasks is preserved in the planning transcript:
`C:\Users\eface\.claude\projects\C--Users-eface\93cb9d45-bacc-41ea-827d-b5444a109d4a.jsonl`

The user's original prompt contains the full master plan — it can be pasted again to restore full context.
