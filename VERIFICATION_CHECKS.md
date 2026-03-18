# Decentralization Plan — Verification Checks

> **Purpose:** Every sub-task must pass ALL of its verification checks before being marked as done. Agents implementing a sub-task should run these checks and report pass/fail for each.
>
> **Legend:** `[AUTO]` = automatable (script/command), `[MANUAL]` = requires human inspection, `[CODE]` = verify by reading code

---

## Phase 1: Keypair Identity System

### 1.1 — Add crypto dependencies

- [ ] `[AUTO]` `cd server/packages/auth && node -e "import('@noble/curves/secp256k1.js').then(() => process.exit(0))"` exits 0
- [ ] `[AUTO]` `cd server/packages/auth && node -e "import('@noble/hashes/sha2.js').then(() => process.exit(0))"` exits 0
- [ ] `[AUTO]` `cd server/packages/auth && node -e "import('@scure/bip39').then(() => process.exit(0))"` exits 0
- [ ] `[AUTO]` `cd server/packages/auth && node -e "import('@scure/bip32').then(() => process.exit(0))"` exits 0
- [ ] `[AUTO]` `cd server/packages/auth && node -e "import('@scure/base').then(() => process.exit(0))"` exits 0
- [ ] `[AUTO]` `npm install` from repo root exits 0 with no version conflicts
- [ ] `[CODE]` `server/packages/auth/package.json` lists all five packages in `dependencies`: `@noble/curves`, `@noble/hashes`, `@scure/bip39`, `@scure/bip32`, `@scure/base` (not devDependencies)
- [ ] `[CODE]` `@noble/ed25519` is NOT in dependencies (wrong curve — Nostr uses secp256k1)
- [ ] `[AUTO]` No other `package.json` files were modified (deps added only to auth package)

### 1.2 — Crypto utility module

- [ ] `[CODE]` `server/packages/auth/src/crypto.ts` exists and exports: `generateMnemonic`, `mnemonicToKeypair`, `generateKeypair`, `encryptPrivateKey`, `decryptPrivateKey`, `encryptMnemonic`, `decryptMnemonic`, `schnorrSign`, `schnorrVerify`, `pubkeyHex`, `pubkeyToNpub`, `privkeyToNsec`
- [ ] `[AUTO]` **Round-trip test:** Generate keypair → encrypt private key with password "test123" → decrypt with same password → recovered key matches original
- [ ] `[AUTO]` **Schnorr sign/verify test:** Generate keypair → schnorrSign(SHA-256 hash of "hello") → schnorrVerify succeeds → tamper with hash → verify fails
- [ ] `[AUTO]` **Mnemonic test:** `generateMnemonic()` returns exactly 12 words, all words are valid BIP39 English wordlist entries
- [ ] `[AUTO]` **Mnemonic determinism test:** `mnemonicToKeypair(mnemonic)` called twice with same mnemonic produces identical keypair
- [ ] `[AUTO]` **NIP-06 derivation:** `mnemonicToKeypair` uses BIP32 derivation path `m/44'/1237'/0'/0/0` (verify by checking against known NIP-06 test vectors)
- [ ] `[AUTO]` **Pubkey format:** `pubkeyHex(publicKey)` returns a 64-character lowercase hex string (32-byte x-only pubkey)
- [ ] `[AUTO]` **Bech32 encoding:** `pubkeyToNpub` returns string starting with `npub1`, `privkeyToNsec` returns string starting with `nsec1`
- [ ] `[AUTO]` **Mnemonic encryption:** `encryptMnemonic("word1 word2 ...", "pass")` → `decryptMnemonic(encrypted, "pass")` → recovers original mnemonic
- [ ] `[CODE]` Encryption uses AES-256-GCM with `crypto.scryptSync` for key derivation (not a custom KDF)
- [ ] `[CODE]` Encryption output format is `v1:salt(32B):nonce(12B):tag(16B):ciphertext` as colon-separated hex with version prefix
- [ ] `[AUTO]` **Wrong password test:** Encrypt with "password1", decrypt with "password2" → throws error (does not return garbage)
- [ ] `[CODE]` Uses `@noble/curves/secp256k1` schnorr property (NOT Ed25519)
- [ ] `[AUTO]` TypeScript compiles: `npx tsc --noEmit` from auth package exits 0

### 1.3 — Database migration: add keypair columns to User

- [ ] `[AUTO]` Migration file exists at `server/prisma/migrations/*_add_keypair_identity/migration.sql`
- [ ] `[AUTO]` `npx prisma migrate dev` applies without errors
- [ ] `[CODE]` `schema.prisma` has `CustodyMode` enum with `CUSTODIAL` and `SELF_CUSTODY` values
- [ ] `[CODE]` `schema.prisma` User model has: `nostrPubkey String? @unique`, `encryptedNsec String?`, `encryptedMnemonic String?`, `custodyMode CustodyMode @default(CUSTODIAL)`
- [ ] `[AUTO]` Existing users are not affected: query `SELECT count(*) FROM users WHERE nostr_pubkey IS NULL` returns count of all pre-existing users
- [ ] `[AUTO]` `npx prisma generate` exits 0 (Prisma client regenerates successfully)
- [ ] `[CODE]` Column mappings use snake_case: `@map("nostr_pubkey")`, `@map("encrypted_nsec")`, `@map("encrypted_mnemonic")`, `@map("custody_mode")`

### 1.4 — Generate keypair on registration

- [ ] `[AUTO]` **Custodial registration:** `POST /api/auth/register` with `{ email, password, displayName }` returns 201 with `mnemonic` (12 words) and `user.nostrPubkey` (64-char hex)
- [ ] `[AUTO]` **DB verification (custodial):** After registration, `SELECT nostr_pubkey, encrypted_nsec, encrypted_mnemonic, custody_mode FROM users WHERE id = '<new_user_id>'` → all non-null, custody_mode = 'CUSTODIAL'
- [ ] `[AUTO]` **Self-custody registration:** `POST /api/auth/register` with `{ email, password, displayName, pubkey: "<64-char hex>" }` returns 201 with NO `mnemonic` and `user.nostrPubkey` matching provided pubkey
- [ ] `[AUTO]` **DB verification (self-custody):** After self-custody registration, `encrypted_nsec IS NULL`, `encrypted_mnemonic IS NULL`, `custody_mode = 'SELF_CUSTODY'`
- [ ] `[AUTO]` **Mnemonic derivation:** The returned mnemonic (custodial path) derives to the same pubkey stored in DB via NIP-06 derivation
- [ ] `[CODE]` Mnemonic is stored encrypted (encryptedMnemonic column), NOT in plaintext
- [ ] `[AUTO]` **Existing registration fields preserved:** Response still contains `user.id`, `user.email`, `user.displayName`, `user.role`, `accessToken`, `refreshToken`
- [ ] `[AUTO]` **Idempotent pubkey:** Two different registrations produce different pubkeys
- [ ] `[CODE]` `registerSchema` accepts optional `pubkey` field (64-char lowercase hex)

### 1.5 — Cache signing key on login

- [ ] `[AUTO]` **Redis test:** After `POST /api/auth/login`, Redis key `signing_key:<userId>` exists
- [ ] `[AUTO]` **Redis TTL:** The Redis key has a TTL > 0 (not persistent) and roughly matches refresh token expiry
- [ ] `[AUTO]` **Redis value encrypted:** The Redis value is NOT raw hex — it's encrypted with `SIGNING_CACHE_KEY` env var
- [ ] `[AUTO]` **JWT payload:** Decode the returned `accessToken` JWT — payload contains `pubkey` field matching user's stored nostrPubkey
- [ ] `[CODE]` `JwtPayload` interface in `shared/src/middleware.ts` includes `pubkey?: string`
- [ ] `[CODE]` `SIGNING_CACHE_KEY` added to config in `shared/src/config.ts`
- [ ] `[AUTO]` **Signing works:** Decrypt Redis value with SIGNING_CACHE_KEY → use it to Schnorr-sign a test message → verify against user's pubkey → passes
- [ ] `[AUTO]` **No pubkey = no Redis key:** Login with a user who has no pubkey yet → `signing_key:<userId>` does NOT exist in Redis
- [ ] `[AUTO]` **Self-custody = no Redis key:** Login with self-custody user → `signing_key:<userId>` does NOT exist in Redis

### 1.6 — Lazy keypair migration for existing users

- [ ] `[AUTO]` **Migration on login:** Create a user without keypair (directly in DB). Login → response includes `mnemonic` (12 words) and `user.nostrPubkey`
- [ ] `[AUTO]` **DB updated:** After login, user now has `nostr_pubkey`, `encrypted_nsec`, and `encrypted_mnemonic` set
- [ ] `[AUTO]` **One-time mnemonic:** Login again with same user → response does NOT include `mnemonic`
- [ ] `[AUTO]` **Recover-mnemonic endpoint:** `POST /api/auth/recover-mnemonic` with `{ password }` for a custodial user → returns `{ mnemonic }` (original 12 words)
- [ ] `[AUTO]` **Recover-mnemonic determinism:** Returned mnemonic derives to the same pubkey as stored in DB
- [ ] `[AUTO]` **Recover-mnemonic wrong password:** Submit wrong password → returns 401
- [ ] `[AUTO]` **Recover-mnemonic self-custody:** Call for self-custody user → returns 400 (self-custody users manage their own keys)
- [ ] `[AUTO]` **Recover-mnemonic auth:** `POST /api/auth/recover-mnemonic` without auth token → returns 401
- [ ] `[CODE]` **No key regeneration:** There is NO route or logic that generates a new keypair for a user who already has one. Pubkeys are immutable.

### 1.7 — Challenge-based login (sovereign mode)

- [ ] `[AUTO]` **Challenge endpoint:** `GET /api/auth/challenge` returns `{ challenge, expiresAt }` where challenge is 64-char hex
- [ ] `[AUTO]` **Challenge stored:** After requesting, Redis key `challenge:<challengeHex>` exists with TTL <= 300s
- [ ] `[AUTO]` **Rate limiting:** More than 10 requests to `/api/auth/challenge` from same IP within 1 minute → returns 429
- [ ] `[AUTO]` **Pubkey login success:** Schnorr-sign SHA-256(challenge bytes) with a known keypair → `POST /api/auth/login/pubkey` with `{ pubkey, challenge, signature }` → returns 200 with `accessToken` and `refreshToken`
- [ ] `[AUTO]` **Challenge consumed:** Same challenge cannot be used twice → second attempt returns 401
- [ ] `[AUTO]` **Expired challenge:** Wait for challenge to expire (or manually delete from Redis) → returns 401
- [ ] `[AUTO]` **Invalid signature:** Submit wrong Schnorr signature → returns 401
- [ ] `[AUTO]` **Unknown pubkey:** Submit valid signature for a pubkey not in the DB → returns 404
- [ ] `[CODE]` `pubkeyLoginSchema` exists in `schemas.ts` and validates `pubkey` (64-char hex), `challenge` (64-char hex), `signature` (128-char hex, Schnorr)

### 1.8 — Key export and custody switch

- [ ] `[AUTO]` **Export keys:** `POST /api/auth/export-keys` with correct `{ password }` → returns `{ privateKey, nsec, pubkey, npub }` (hex and bech32 formats)
- [ ] `[AUTO]` **Export verifiable:** The returned privateKey can Schnorr-sign a message that verifies against the returned pubkey
- [ ] `[AUTO]` **Export bech32:** `nsec` starts with `nsec1`, `npub` starts with `npub1`
- [ ] `[AUTO]` **Export wrong password:** Submit wrong password → returns 401
- [ ] `[AUTO]` **Export self-custody:** Call for self-custody user → returns error (no key to export)
- [ ] `[AUTO]` **Switch custody:** `POST /api/auth/switch-custody` with `{ mode: "SELF_CUSTODY", password }` → returns 200
- [ ] `[AUTO]` **DB after switch:** User's `encrypted_nsec` is NULL, `encrypted_mnemonic` is NULL, `custody_mode` is 'SELF_CUSTODY'
- [ ] `[AUTO]` **Redis after switch:** `signing_key:<userId>` no longer exists in Redis
- [ ] `[CODE]` **One-way warning:** Response or documentation notes that switching to self-custody is irreversible

### 1.9 — Frontend: mnemonic display on registration (web)

- [ ] `[CODE]` `ApiAuthResponse` type in `web/src/types.ts` includes `mnemonic?: string`
- [ ] `[CODE]` `ApiUser` type in `web/src/types.ts` includes `nostrPubkey?: string`
- [ ] `[CODE]` Registration flow shows a modal/dialog when `mnemonic` is present in response
- [ ] `[CODE]` Modal displays exactly 12 words in a readable grid/list layout
- [ ] `[CODE]` Modal has a "Copy" button for the mnemonic
- [ ] `[CODE]` Modal has a confirmation checkbox — cannot dismiss without checking it
- [ ] `[CODE]` Modal has an "I'll do this later" escape hatch with a warning about identity loss
- [ ] `[CODE]` Mnemonic is NOT written to `localStorage` or any persistent browser storage
- [ ] `[AUTO]` `npx tsc --noEmit` from `web/` exits 0
- [ ] `[MANUAL]` Visual: register a new account in browser, mnemonic modal appears and looks correct

### 1.10 — Frontend: mnemonic display on first login migration (web)

- [x] `[CODE]` Login handler checks for `mnemonic` in response and triggers same modal as registration
- [x] `[MANUAL]` Login with a pre-migration user in browser → mnemonic modal appears
- [x] `[MANUAL]` Login with a user who already has a keypair → no mnemonic modal

### 1.11 — Electron client: mnemonic flow

- [x] `[CODE]` `ApiAuthResponse` type in `client/src/renderer/types.ts` includes `mnemonic?: string`
- [x] `[CODE]` Registration and login flows in Electron renderer show mnemonic modal (same behavior as web)
- [x] `[AUTO]` `npx tsc --noEmit` from `client/` exits 0
- [x] `[MANUAL]` Register in Electron client → mnemonic modal appears

### 1.12 — Electron client: client-side keypair generation

- [x] `[CODE]` IPC handler `crypto:generate-keypair` exists in `client/src/main/index.ts` — uses `@noble/curves/secp256k1` + NIP-06 derivation
- [x] `[CODE]` IPC handler `crypto:sign-challenge` exists in `client/src/main/index.ts` — Schnorr signs SHA-256(challenge)
- [x] `[CODE]` Both channels exposed in `preload.ts` under `window.boilerdeck.crypto`
- [x] `[CODE]` Type declarations in `env.d.ts` match preload bridge
- [x] `[CODE]` `@noble/curves`, `@scure/bip39`, `@scure/bip32`, `@scure/base` in client dependencies
- [x] `[CODE]` Registration page has a toggle "Generate keys on this device (advanced)"
- [x] `[AUTO]` **Client-side registration:** Register with client-side key gen → server DB has `nostr_pubkey` set but `encrypted_nsec` is NULL, `encrypted_mnemonic` is NULL, `custody_mode` is 'SELF_CUSTODY'
- [x] `[CODE]` Private key stored in Electron store (encrypted at rest via safeStorage)
- [x] `[CODE]` Self-custody Electron login uses challenge-based auth (1.7), not password
- [x] `[AUTO]` `npx tsc --noEmit` from `client/` exits 0

### 1.13 — Password change flow

- [ ] `[AUTO]` **Change password:** `POST /api/auth/change-password` with `{ currentPassword, newPassword }` → returns 200
- [ ] `[AUTO]` **Wrong current password:** Submit wrong `currentPassword` → returns 401
- [ ] `[AUTO]` **Re-encrypted keys:** After password change, `decryptPrivateKey(user.encryptedNsec, newPassword)` succeeds and produces same key
- [ ] `[AUTO]` **Re-encrypted mnemonic:** After password change, `decryptMnemonic(user.encryptedMnemonic, newPassword)` succeeds and produces original mnemonic
- [ ] `[AUTO]` **Old password fails:** After change, `decryptPrivateKey(user.encryptedNsec, oldPassword)` throws error
- [ ] `[AUTO]` **Refresh tokens invalidated:** All existing refresh tokens for user are deleted after password change
- [ ] `[AUTO]` **Redis cache cleared:** `signing_key:<userId>` no longer exists after password change
- [ ] `[AUTO]` **Login with new password:** `POST /api/auth/login` with new password succeeds and re-populates Redis
- [ ] `[AUTO]` **Self-custody user:** Change password for self-custody user → succeeds (only bcrypt hash changes, no keys to re-encrypt)
- [ ] `[CODE]` `changePasswordSchema` in `schemas.ts` validates `currentPassword` (min 1) and `newPassword` (min 8)
- [ ] `[AUTO]` `npx tsc --noEmit` from auth package exits 0

---

## Phase 1 — Gate Check (must pass before starting Phase 2)

- [ ] `[AUTO]` All existing auth endpoints still work (register, login, refresh, logout, getMe)
- [ ] `[AUTO]` Every newly registered user has a `nostr_pubkey` in the DB
- [ ] `[AUTO]` Login with custodial user populates `signing_key:<userId>` in Redis (encrypted)
- [ ] `[AUTO]` Login with self-custody user does NOT populate `signing_key:<userId>`
- [ ] `[AUTO]` JWT tokens contain `pubkey` claim
- [ ] `[AUTO]` Password change re-encrypts keys and invalidates sessions
- [ ] `[AUTO]` Recover-mnemonic returns original 12 words for custodial users
- [ ] `[AUTO]` Full server test suite passes (if one exists) — `npm test` exits 0
- [ ] `[AUTO]` `npx tsc --noEmit` exits 0 for: server packages, web, client

---

## Phase 2: Event Schema & Signing

### 2.1 — Create events table migration

- [ ] `[AUTO]` Migration file exists at `server/prisma/migrations/*_add_events_table/migration.sql`
- [ ] `[AUTO]` `npx prisma migrate dev` applies without errors
- [ ] `[CODE]` `Event` model in schema.prisma has: `id` (String @id), `pubkey` (String), `createdAt` (Int, mapped to `created_at_unix`), `kind` (Int), `tags` (Json), `content` (String), `sig` (String), `dTag` (String?), `receivedAt` (DateTime)
- [ ] `[CODE]` `Event` model has indexes on: `kind`, `pubkey`, `createdAt`, and a unique constraint on `[pubkey, kind, dTag]`
- [ ] `[CODE]` `Game` model has `eventId String? @unique @map("event_id")`
- [ ] `[AUTO]` Existing data untouched after migration

### 2.2 — Event utility module

- [ ] `[CODE]` `server/packages/shared/src/events.ts` exists and exports: `serializeEvent`, `hashEvent`, `createEvent`, `verifyEvent`, and kind constants (`EVENT_KIND_GAME_LISTING`, etc.)
- [ ] `[CODE]` `serializeEvent` produces NIP-01 canonical JSON: `[0, pubkey, created_at, kind, tags, content]`
- [ ] `[AUTO]` **Create + verify test:** `createEvent(params)` returns event with valid `id` (SHA-256 of serialized) and valid `sig` (Schnorr/secp256k1)
- [ ] `[AUTO]` **Tamper detection test:** Modify `content` after creation → `verifyEvent()` returns false
- [ ] `[AUTO]` **Tamper ID test:** Modify `id` after creation → `verifyEvent()` returns false
- [ ] `[AUTO]` **Tamper sig test:** Modify `sig` after creation → `verifyEvent()` returns false
- [ ] `[CODE]` Exported from `shared/src/index.ts`
- [ ] `[AUTO]` `npx tsc --noEmit` from shared package exits 0

### 2.3 — Event storage service

- [ ] `[CODE]` `server/packages/shared/src/eventStore.ts` exists and exports: `storeEvent`, `getEvent`, `queryEvents`
- [ ] `[AUTO]` **Store + retrieve:** Store a valid event → `getEvent(id)` returns it with all fields intact
- [ ] `[AUTO]` **Duplicate rejection:** Store same event twice → second call returns DUPLICATE (not error)
- [ ] `[AUTO]` **Invalid event rejection:** Store an event with bad signature → rejects
- [ ] `[AUTO]` **Replaceable event semantics:** Store two events with same `pubkey + kind + dTag` → only the newer one is returned by `queryEvents`
- [ ] `[AUTO]` **Query by kind:** `queryEvents({ kinds: [30001] })` returns only kind 30001 events
- [ ] `[AUTO]` **Query by author:** `queryEvents({ authors: [pubkey] })` returns only events by that pubkey
- [ ] `[AUTO]` **Query with limit:** `queryEvents({ limit: 5 })` returns at most 5 events
- [ ] `[AUTO]` **Query since/until:** Events outside the time range are excluded

### 2.4 — Server-side signing service

- [ ] `[CODE]` `server/packages/auth/src/signing.ts` exists and exports `signEventForUser`
- [ ] `[AUTO]` **Sign test:** Login a user (populates Redis) → `signEventForUser(userId, { kind: 1, tags: [], content: "test" })` returns a valid signed event
- [ ] `[AUTO]` **Event pubkey matches user:** The returned event's `pubkey` matches the user's DB pubkey
- [ ] `[AUTO]` **No Redis key = error:** Without logging in first (no Redis key) → `signEventForUser` throws `UnauthorizedError`
- [ ] `[AUTO]` **Event verifiable:** `verifyEvent(returnedEvent)` returns true
- [ ] `[AUTO]` `npx tsc --noEmit` from auth package exits 0

### 2.5 — Wrap game creation in event signing

- [ ] `[AUTO]` **Create game → event exists:** `POST /api/developer/games` → query `events` table for kind 30001 with matching slug in `d` tag → event exists
- [ ] `[AUTO]` **Event content correct:** Parse event's `content` JSON → contains `title`, `description`, `priceCents`, `slug` matching the created game
- [ ] `[AUTO]` **Event verifiable:** `verifyEvent(storedEvent)` returns true
- [ ] `[AUTO]` **Game.eventId linked:** The game row's `event_id` matches the event's `id`
- [ ] `[AUTO]` **REST response unchanged:** The `POST /api/developer/games` response shape has not changed (no breaking changes)
- [ ] `[AUTO]` **Existing game creation still works:** Creating a game via API succeeds end-to-end

### 2.6 — Wrap game updates and publishing in event signing

- [ ] `[AUTO]` **Update game → new event:** Update a game → query events table → a newer kind 30001 event exists with updated content
- [ ] `[AUTO]` **Replaceable:** Only one kind 30001 event per game slug per author (old one replaced)
- [ ] `[AUTO]` **Publish → status tag:** Publish a game → event tags contain `["status", "PUBLISHED"]`
- [ ] `[AUTO]` **Game.eventId updated:** The game row's `event_id` points to the newest event

### 2.7 — Wrap game version creation in event signing

- [ ] `[AUTO]` **Upload version → event exists:** Upload a game version → kind 30002 event exists in DB
- [ ] `[AUTO]` **Event content correct:** Event content JSON contains `version`, `fileSizeBytes`, `infoHash`
- [ ] `[AUTO]` **Event tags correct:** Tags include `["d", "<slug>:<version>"]`, `["e", gameEventId]`, `["game", slug]`
- [ ] `[AUTO]` **Event verifiable:** `verifyEvent(storedEvent)` returns true

### 2.8 — REST endpoint for pre-signed events

- [ ] `[AUTO]` **POST /api/events with valid event:** Submit a pre-signed event → returns 201, event stored
- [ ] `[AUTO]` **POST /api/events with bad signature:** Submit event with invalid sig → returns 400
- [ ] `[AUTO]` **POST /api/events pubkey mismatch:** Submit event where `event.pubkey` != authenticated user's pubkey → returns 403
- [ ] `[AUTO]` **GET /api/events query:** `GET /api/events?kinds=30001&limit=10` → returns matching events
- [ ] `[AUTO]` **GET /api/events by author:** `GET /api/events?authors=<pubkey>` → returns only that author's events
- [ ] `[AUTO]` **Auth required for POST:** `POST /api/events` without auth → returns 401
- [ ] `[AUTO]` **GET is public:** `GET /api/events` without auth → returns 200

### 2.9 — Event materialization layer

- [ ] `[CODE]` `server/packages/shared/src/eventMaterializer.ts` exists and exports `materializeEvent`
- [ ] `[AUTO]` **Kind 30001 materializes to games:** Submit a kind 30001 event via `POST /api/events` → `games` table row is created/updated with matching data
- [ ] `[AUTO]` **Kind 30002 materializes to game_versions:** Submit a kind 30002 event → `game_versions` table row is created/updated
- [ ] `[AUTO]` **Idempotent:** Materialize the same event twice → no error, no duplicate rows
- [ ] `[AUTO]` **REST API reflects materialized data:** After submitting a kind 30001 event, `GET /api/games/<slug>` returns the game with correct data
- [ ] `[CODE]` Materialization is called from both the `POST /api/events` endpoint AND internal signing flow

### 2.10 — Add pubkey to public API responses

- [ ] `[AUTO]` **getMe includes pubkey:** `GET /api/auth/me` response includes `pubkey` and `custodyMode`
- [ ] `[AUTO]` **Game detail includes developer pubkey:** `GET /api/games/<slug>` response includes developer's `pubkey`
- [ ] `[AUTO]` **Game list includes eventId:** `GET /api/games` response items include `eventId` field
- [ ] `[AUTO]` **Backwards compatible:** Fields are optional (null/undefined for legacy data), existing consumers don't break

### 2.11 — Frontend types and API updates

- [ ] `[CODE]` `web/src/types.ts` has `pubkey?: string` and `custodyMode?: string` on `ApiUser`
- [ ] `[CODE]` `web/src/types.ts` has `eventId?: string` on `ApiGame` / `ApiGameDetail`
- [ ] `[CODE]` `client/src/renderer/types.ts` has matching type changes
- [ ] `[CODE]` An `Event` type is defined matching `{ id, pubkey, created_at, kind, tags, content, sig }`
- [ ] `[AUTO]` `npx tsc --noEmit` exits 0 for both `web/` and `client/`

---

## Phase 2 — Gate Check (must pass before starting Phase 3)

- [ ] `[AUTO]` All existing REST endpoints work unchanged (games, auth, licenses, payments)
- [ ] `[AUTO]` Every game creation/update/publish produces a corresponding signed event
- [ ] `[AUTO]` Pre-signed events can be submitted and materialized into legacy tables
- [ ] `[AUTO]` `verifyEvent()` passes for every event in the events table
- [ ] `[AUTO]` `npx tsc --noEmit` exits 0 for all packages

---

## Phase 3: Relay Infrastructure

### 3.1 — Event Schema and Crypto Utilities (relay package)

- [ ] `[CODE]` `server/packages/relay/src/crypto.ts` exists with secp256k1 Schnorr sign/verify functions (reuses auth/crypto.ts or shared)
- [ ] `[CODE]` `server/packages/relay/src/types.ts` defines `RelayEvent`, `EventFilter`, `Subscription` interfaces
- [ ] `[AUTO]` **Sign + verify round-trip:** Generate keypair → sign event → verify → passes
- [ ] `[AUTO]` **Tamper detection:** Modify signed event content → verify → fails
- [ ] `[CODE]` Event structure matches NIP-01: `{ id, pubkey, created_at, kind, tags, content, sig }`

### 3.2 — Prisma Schema: Events Table + User Keypair

- [ ] `[AUTO]` Migration applies cleanly
- [ ] `[CODE]` `Event` model has indexes on `kind`, `pubkey`, `createdAt`, `[kind, createdAt]`
- [ ] `[CODE]` `User` model has `nostrPubkey String? @unique`, `encryptedNsec String?`, `encryptedMnemonic String?`, `custodyMode CustodyMode` fields
- [ ] `[AUTO]` Insert a test event via Prisma, query it back — round-trip succeeds

### 3.3 — Relay Package Skeleton

- [ ] `[CODE]` `server/packages/relay/package.json` exists with name `@boilerdeck/relay`
- [ ] `[CODE]` `server/packages/relay/src/index.ts` exports service and route modules
- [ ] `[CODE]` `server/packages/relay/src/service.ts` exports `storeEvent`, `queryEvents`, `deleteEvent`
- [ ] `[CODE]` `server/packages/relay/src/routes.ts` defines `POST /api/events`, `GET /api/events`, `GET /api/events/:id`
- [ ] `[AUTO]` `npm install` from root resolves `@boilerdeck/relay` as workspace package
- [ ] `[AUTO]` **REST round-trip:** POST an event → GET it back by ID → matches

### 3.4 — WebSocket Relay Endpoint

- [ ] `[CODE]` `server/packages/relay/src/ws.ts` exists and exports `attachRelayWebSocket`
- [ ] `[CODE]` `server/src/index.ts` creates `http.Server` explicitly and calls `attachRelayWebSocket(server)`
- [ ] `[AUTO]` **WS connection:** WebSocket client connects to `ws://localhost:3000/relay` → connection accepted
- [ ] `[AUTO]` **REQ/EVENT flow:** Client sends `["REQ", "sub1", { kinds: [1] }]` → receives `["EOSE", "sub1"]`
- [ ] `[AUTO]` **Event publishing:** Client A publishes `["EVENT", signedEvent]`, Client B with matching subscription receives `["EVENT", "sub1", signedEvent]`
- [ ] `[AUTO]` **OK response:** After publishing, client receives `["OK", eventId, true, ""]`
- [ ] `[AUTO]` **CLOSE:** Client sends `["CLOSE", "sub1"]` → no more events for that subscription
- [ ] `[AUTO]` **Invalid event rejection:** Publish event with bad signature → receives `["OK", eventId, false, "invalid:..."]`
- [ ] `[CODE]` Nginx config documented or included for WebSocket proxy on `/relay`

### 3.5 — Keypair Generation on Registration + Key Management

- [ ] `[AUTO]` **Register → pubkey returned:** `POST /api/auth/register` response includes `pubkey`
- [ ] `[AUTO]` **Login backfill:** Login with user without pubkey → pubkey generated and returned
- [ ] `[AUTO]` **Key export:** `GET /api/relay/me/keys` (authenticated) → returns `{ pubkey, privkey }` both hex
- [ ] `[AUTO]` **Key import:** `POST /api/relay/me/import-key` with `{ privkey }` → pubkey updated to match
- [ ] `[CODE]` Private key encrypted at rest with `EVENT_SIGNING_KEY` env var using AES-256-GCM

### 3.6 — Server-Side Event Signing (for Web Users)

- [ ] `[AUTO]` **Sign-and-publish:** Authenticated `POST /api/events/sign-and-publish` with `{ kind, content, tags }` → returns full signed event
- [ ] `[AUTO]` **Event verifiable:** Returned event passes `verifyEvent()`
- [ ] `[AUTO]` **Event pubkey matches user:** Event's pubkey matches the authenticated user's pubkey
- [ ] `[AUTO]` **Event stored:** Event appears in `GET /api/events/:id`
- [ ] `[AUTO]` **Event broadcast:** Another WS subscriber with matching filter receives the event

### 3.7 — Electron Client: Relay Connection Manager

- [ ] `[CODE]` `client/src/main/relayManager.ts` exists with connect/disconnect/subscribe/publish functions
- [ ] `[CODE]` IPC channels `relay:connect`, `relay:disconnect`, `relay:subscribe`, `relay:unsubscribe`, `relay:publish`, `relay:on-event` exist
- [ ] `[CODE]` All IPC channels exposed in `preload.ts` and typed in `env.d.ts`
- [ ] `[AUTO]` **Connection test:** Electron app connects to local relay WebSocket on startup
- [ ] `[CODE]` Auto-reconnect with exponential backoff implemented (1s, 2s, 4s, max 30s)
- [ ] `[CODE]` Re-sends active subscriptions on reconnect

### 3.8 — External Relay Federation (Outbound)

- [ ] `[CODE]` `server/packages/relay/src/federation.ts` exists
- [ ] `[CODE]` Reads `EXTERNAL_RELAYS` env var for relay URLs
- [ ] `[AUTO]` **Event forwarding:** Publish an event locally → it appears on a configured external relay
- [ ] `[CODE]` Only forwards events authored by local users (pubkeys in User table)
- [ ] `[CODE]` Does not re-broadcast imported events (loop prevention)
- [ ] `[CODE]` Reconnects on failure with exponential backoff

### 3.9 — External Relay Federation (Inbound)

- [ ] `[AUTO]` **Inbound import:** Publish an event on external relay with tag matching a local game slug → event imported to local DB
- [ ] `[AUTO]` **Duplicate handling:** Import same event twice → no error, no duplicate
- [ ] `[AUTO]` **Signature verification:** Import event with bad signature → rejected
- [ ] `[CODE]` Imported events NOT re-forwarded outbound

### 3.10 — Relay Discovery Endpoint

- [ ] `[AUTO]` **REST info:** `GET /api/relay/info` returns JSON with `relay_url`, `name`, `description`, `supported_nips`, `version`
- [ ] `[AUTO]` **NIP-11:** HTTP GET to `/relay` with `Accept: application/nostr+json` header returns relay info document (not WebSocket upgrade)
- [ ] `[CODE]` External relays list included in info response

---

## Phase 3 — Gate Check

- [ ] `[AUTO]` WebSocket relay accepts connections and handles REQ/EVENT/CLOSE/OK/EOSE
- [ ] `[AUTO]` REST and WebSocket coexist on same server
- [ ] `[AUTO]` Events published via REST appear on WebSocket subscribers and vice versa
- [ ] `[AUTO]` Federation outbound and inbound work with at least one external relay
- [ ] `[AUTO]` All existing REST endpoints still work

---

## Phase 4: Social Features

### 4.1 — Event Kind Definitions and Validation

- [ ] `[CODE]` `server/packages/relay/src/kinds.ts` exports kind constants and validation functions
- [ ] `[CODE]` All kinds defined: 0 (profile), 1 (text note), 3 (follow list), 5 (deletion), 7 (reaction), 31337 (review), 31338 (attestation)
- [ ] `[AUTO]` **Valid events pass:** Submit correctly-formed event for each kind → accepted
- [ ] `[AUTO]` **Invalid events rejected:** Submit event with missing required tags per kind → rejected with descriptive error
- [ ] `[AUTO]` **Kind 31337 requires `d` tag:** Review without `["d", slug]` → rejected
- [ ] `[AUTO]` **Kind 31338 requires `p` and `d` tags:** Attestation without required tags → rejected

### 4.2 — Profile Events (Kind 0)

- [ ] `[AUTO]` **Set profile:** `PUT /api/profiles/me` with `{ name, about, picture }` → creates kind 0 event
- [ ] `[AUTO]` **Get profile:** `GET /api/profiles/<pubkey>` returns profile data from latest kind 0 event
- [ ] `[AUTO]` **Replaceable:** Update profile → only one kind 0 event per pubkey exists
- [ ] `[AUTO]` **Migration from displayName:** First profile creation seeds content from existing `displayName`

### 4.3 — Review Events (Kind 31337)

- [ ] `[AUTO]` **Submit review:** `POST /api/games/:slug/reviews` with `{ rating: 4, title: "Great", body: "..." }` → creates kind 31337 event
- [ ] `[AUTO]` **Ownership required:** Submit review without a license for the game → 403
- [ ] `[AUTO]` **Get reviews:** `GET /api/games/:slug/reviews` returns reviews with rating, title, body, author pubkey
- [ ] `[AUTO]` **One review per user per game:** Submit second review → replaces first (parameterized replaceable on `d` tag)
- [ ] `[AUTO]` **Aggregation:** `GET /api/games/:slug/reviews` response includes `averageRating` and `reviewCount`
- [ ] `[AUTO]` **Rating validation:** Rating outside 1-5 → rejected

### 4.4 — Review Display UI

- [ ] `[CODE]` Game detail page (web + client) has a "Reviews" section below description
- [ ] `[CODE]` Shows average star rating, individual review cards with author, rating, title, body, timestamp
- [ ] `[CODE]` Pagination via "Load More" button
- [ ] `[MANUAL]` Visual: reviews render correctly on a game with 3+ reviews

### 4.5 — Review Submission UI

- [ ] `[CODE]` `ReviewForm` component exists in both `web/` and `client/` with star selector, title, body, submit
- [ ] `[CODE]` "Write a Review" button only visible if user owns the game and hasn't reviewed yet
- [ ] `[MANUAL]` Submit a review from web UI → it appears in the review list
- [ ] `[CODE]` Electron client signs review event locally and publishes via relay WebSocket (not REST)

### 4.6 — Follow List Events (Kind 3)

- [ ] `[AUTO]` **Follow:** `POST /api/follows` with `{ pubkey: targetPubkey }` → creates/updates kind 3 event
- [ ] `[AUTO]` **Get follows:** `GET /api/follows/<pubkey>` returns list of followed pubkeys
- [ ] `[AUTO]` **Unfollow:** `DELETE /api/follows/<pubkey>` → updates kind 3 event, target removed
- [ ] `[AUTO]` **Replaceable:** Follow list is a single kind 3 event, updated atomically

### 4.7 — User Profile Page

- [ ] `[CODE]` Route `/profile/:pubkey` exists in web and client
- [ ] `[CODE]` Shows: display name, bio, avatar, member since, review count, follow/unfollow button
- [ ] `[MANUAL]` Navigate to a user profile → data renders correctly
- [ ] `[CODE]` Seeder reputation placeholder present (for Phase 5)

### 4.8 — Comment Events (Kind 1 with Tags)

- [ ] `[AUTO]` **Submit reply:** `POST /api/events/:eventId/replies` with `{ content }` → creates kind 1 event with `["e", parentEventId]` tag
- [ ] `[AUTO]` **Get replies:** `GET /api/events/:eventId/replies` returns reply events
- [ ] `[AUTO]` **Threading:** Reply to a reply → both appear in threaded structure
- [ ] `[CODE]` Display depth limited to 2-3 levels

### 4.9 — Moderation: Mute and Report

- [ ] `[AUTO]` **Mute:** `POST /api/moderation/mute` with `{ pubkey }` → user's mute list updated
- [ ] `[AUTO]` **Muted events filtered:** After muting, WS subscriber does not receive events from muted pubkey
- [ ] `[AUTO]` **Unmute:** `DELETE /api/moderation/mute/<pubkey>` → events from that pubkey reappear
- [ ] `[AUTO]` **Admin deletion:** Admin user can delete events via kind 5 deletion event
- [ ] `[CODE]` Relay has its own keypair for admin-level deletion events

---

## Phase 4 — Gate Check

- [ ] `[AUTO]` Profiles, reviews, follows, comments all stored as verifiable signed events
- [ ] `[AUTO]` All social data accessible via both REST and WebSocket
- [ ] `[AUTO]` Moderation (mute/report/admin delete) works
- [ ] `[AUTO]` Existing game/auth/payment endpoints unaffected

---

## Phase 5: Seeding Reputation

### 5.1 — Attestation Event Kind (31338) and Validation

- [ ] `[CODE]` Kind 31338 defined in `kinds.ts` with validation rules
- [ ] `[AUTO]` **Valid attestation stored:** Submit well-formed attestation event → accepted
- [ ] `[AUTO]` **Self-attestation rejected:** Attestation where signer pubkey == `p` tag pubkey → rejected
- [ ] `[AUTO]` **Unknown infoHash rejected:** Attestation referencing non-existent torrent → rejected
- [ ] `[AUTO]` **Bytes validation:** `bytesDownloaded > torrent file size` → rejected
- [ ] `[AUTO]` **Parameterized replaceable:** One attestation per (signer, seeder, infoHash) — second replaces first

### 5.2 — Electron Client: Auto-Generate Attestations After Download

- [ ] `[CODE]` `client/src/main/attestation.ts` exists
- [ ] `[CODE]` `torrentManager.ts` calls attestation generation in `torrent.on("done")` handler
- [ ] `[AUTO]` **Auto-attestation:** Complete a download → attestation event published to relay
- [ ] `[CODE]` Attestation includes `infoHash`, `bytesDownloaded`, `durationSeconds`
- [ ] `[CODE]` `p` tag references VPS seed box pubkey (or swarm attestation)

### 5.3 — VPS Seed Box Attestation

- [ ] `[CODE]` `scripts/seed-attestation-cron.ts` exists
- [ ] `[CODE]` Script reads `VPS_SEED_PRIVKEY` env var for signing
- [ ] `[AUTO]` **Script runs:** Execute script → attestation events published via `POST /api/events`
- [ ] `[CODE]` Queries Transmission RPC for completed transfer data
- [ ] `[AUTO]` Published attestation events pass `verifyEvent()`

### 5.4 — Reputation Aggregation Service

- [ ] `[CODE]` `server/packages/relay/src/reputation.ts` exists and exports reputation computation
- [ ] `[AUTO]` **Score computation:** Create 5 attestations from 3 unique pubkeys → `GET /api/reputation/<pubkey>` returns non-zero score with correct `attestationCount` and `uniqueAttesters`
- [ ] `[AUTO]` **Zero attestations = zero score:** Query reputation for pubkey with no attestations → score 0
- [ ] `[CODE]` Score uses logarithmic formula (resists inflation)
- [ ] `[AUTO]` **Redis caching:** Second request within 15 minutes is faster (cache hit)
- [ ] `[CODE]` Anti-sybil: accounts < 7 days old weighted at 0.1x, max 20 attestations per attester per day

### 5.5 — Reputation Display in UI

- [ ] `[CODE]` Profile page shows "Seeder Score" with value
- [ ] `[CODE]` Game detail page shows "Top Seeders" section
- [ ] `[CODE]` Badge system: Bronze (>=10), Silver (>=50), Gold (>=200)
- [ ] `[MANUAL]` Profile with attestations shows non-zero score and appropriate badge

### 5.6 — Web of Trust Weighting

- [ ] `[AUTO]` **Personalized score:** `GET /api/reputation/<pubkey>?viewer=<viewerPubkey>` returns different score than global
- [ ] `[AUTO]` **Follow weighting:** Attestation from a followed user weighted 1.0x, unknown user 0.25x
- [ ] `[AUTO]` **Muted = zero weight:** Attestation from muted user weighted 0x
- [ ] `[AUTO]` **Fallback:** No viewer specified → returns global (unweighted) score

---

## Phase 5 — Gate Check

- [ ] `[AUTO]` Attestation events validated and stored
- [ ] `[AUTO]` Reputation scores computed and cached
- [ ] `[AUTO]` Electron auto-attestation works end-to-end
- [ ] `[AUTO]` Web of trust weighting produces differentiated scores

---

## Phase 6: Privacy Layer

### 6.1 — Privacy settings store schema and IPC

- [ ] `[CODE]` `StoreData` interface includes `privacySettings: { enabled, mode, socksHost, socksPort, routeApiTraffic, routeTorrentTraffic }`
- [ ] `[CODE]` `"privacySettings"` in `STORE_KEY_WHITELIST`
- [ ] `[CODE]` IPC channels `privacy:get-status`, `privacy:test-connection` in main process
- [ ] `[CODE]` Preload bridge and `env.d.ts` updated with privacy IPC
- [ ] `[AUTO]` **Store round-trip:** Write privacy settings via IPC → read back → matches

### 6.2 — SOCKS5 proxy module for HTTP traffic

- [ ] `[CODE]` `client/src/main/proxyManager.ts` exists and exports `getProxyAgent`, `testProxyConnection`
- [ ] `[CODE]` Uses `socks-proxy-agent` package
- [ ] `[AUTO]` **Test connection:** With a valid SOCKS5 proxy configured, `testProxyConnection` returns success
- [ ] `[AUTO]` **Test connection failure:** With invalid proxy, `testProxyConnection` returns failure (not crash)
- [ ] `[CODE]` `privacy:test-connection` IPC handler wired up

### 6.3 — Route API traffic through proxy

- [ ] `[CODE]` IPC channel `api:proxied-fetch` exists in main process
- [ ] `[CODE]` Preload bridge exposes `window.boilerdeck.api.fetch`
- [ ] `[CODE]` Renderer's `apiFetch` checks privacy mode and routes through IPC when enabled
- [ ] `[AUTO]` **Proxied request:** Enable privacy mode → API call succeeds through proxy
- [ ] `[AUTO]` **Direct request still works:** Privacy mode off → API calls go directly (no proxy)

### 6.4 — Route BitTorrent traffic through SOCKS5

- [ ] `[CODE]` `torrentManager.ts` accepts privacy config and disables `dht`, `lsd`, `webSeeds` when privacy mode on
- [ ] `[AUTO]` **Privacy mode download:** Enable torrent privacy → download completes (possibly slower)
- [ ] `[AUTO]` **No DHT in privacy mode:** When privacy mode enabled, verify DHT is disabled (no UDP traffic)
- [ ] `[CODE]` Warning about reduced speed documented in code/UI

### 6.5 — Tor binary bundling and management

- [ ] `[CODE]` `client/src/main/torManager.ts` exists with `startTor`, `stopTor`, `isTorRunning`, `getTorStatus`
- [ ] `[CODE]` `electron-builder` config includes `tor.exe` as `extraResource`
- [ ] `[AUTO]` **Tor starts:** Set mode to "tor" → Tor process spawns and SOCKS5 port 9150 becomes reachable
- [ ] `[AUTO]` **Tor stops:** `stopTor()` → process terminated, port no longer listening
- [ ] `[CODE]` Graceful shutdown on `app.on("before-quit")`
- [ ] `[CODE]` Tor data directory in app userData (not temp)

### 6.6 — Privacy Settings UI page

- [ ] `[CODE]` Settings page has "Privacy & Network" section
- [ ] `[CODE]` Toggle for Private Mode (on/off)
- [ ] `[CODE]` Radio group: "Tor (built-in)" / "Custom SOCKS5" / "Off"
- [ ] `[CODE]` Custom SOCKS5 shows host/port fields
- [ ] `[CODE]` "Route API traffic" and "Route torrent traffic" checkboxes
- [ ] `[CODE]` "Test Connection" button with status indicator
- [ ] `[CODE]` Tor bootstrap progress display
- [ ] `[MANUAL]` Toggle privacy on/off → settings persist across restart

### 6.7 — Gateway .onion endpoint documentation

- [ ] `[CODE]` `ONION_ADDRESS` config option added to server config schema
- [ ] `[CODE]` `docs/privacy.md` exists with Tor hidden service setup instructions
- [ ] `[CODE]` Client uses `.onion` address when in Tor mode (if configured)

---

## Phase 6 — Gate Check

- [ ] `[AUTO]` API traffic can be routed through SOCKS5/Tor proxy
- [ ] `[AUTO]` Torrent downloads work in privacy mode (with DHT disabled)
- [ ] `[AUTO]` Tor binary bundles and starts/stops correctly
- [ ] `[MANUAL]` Settings UI fully functional

---

## Phase 7: Content Generalization

### 7.1 — Schema: Add content type and generic metadata

- [ ] `[AUTO]` Migration applies cleanly
- [ ] `[CODE]` `ContentType` enum: `GAME`, `VIDEO`, `SOFTWARE`, `AUDIO`, `OTHER`
- [ ] `[CODE]` `Game` model has `contentType ContentType @default(GAME)` and `metadata Json @default("{}")`
- [ ] `[AUTO]` Existing games have `contentType: GAME` after migration

### 7.2 — Schema: Rename Game to Listing

- [ ] `[CODE]` Prisma model renamed from `Game` to `Listing` with `@@map("games")` preserved
- [ ] `[CODE]` `GameVersion` → `ListingVersion`, `GameStatus` → `ListingStatus` with `@@map` preserved
- [ ] `[AUTO]` No SQL migration needed (table names unchanged)
- [ ] `[AUTO]` All server packages compile after find-and-replace `db.game.` → `db.listing.`
- [ ] `[AUTO]` All existing REST endpoints still work identically

### 7.3 — Server: Generalize catalog service

- [ ] `[CODE]` Service functions accept `contentType` parameter
- [ ] `[CODE]` `createListing` accepts `contentType` and `metadata`
- [ ] `[CODE]` Old function names exist as aliases (backwards compat)
- [ ] `[AUTO]` **Create non-game listing:** `createListing({ contentType: 'VIDEO', ... })` succeeds
- [ ] `[AUTO]` **Filter by type:** `listPublishedListings({ contentType: 'GAME' })` returns only games

### 7.4 — Server: Generalize catalog routes

- [ ] `[AUTO]` `GET /api/listings` returns published listings
- [ ] `[AUTO]` `GET /api/listings?contentType=GAME` returns same results as `GET /api/games`
- [ ] `[AUTO]` `POST /api/developer/listings` with `contentType` in body creates listing
- [ ] `[AUTO]` Old `/games` routes still work (call same service with `contentType: 'GAME'`)
- [ ] `[AUTO]` `GET /api/listings/:slug` returns listing detail

### 7.5 — Server: Generalize upload pipeline

- [ ] `[AUTO]` **Video upload:** Upload a `.mp4` as `contentType: VIDEO` → succeeds, torrent created
- [ ] `[CODE]` Exe detection skipped for non-GAME content types
- [ ] `[CODE]` File type validation based on `contentType`
- [ ] `[AUTO]` **Game upload unchanged:** Upload `.zip` with `.exe` as GAME → works as before

### 7.6 — Server: Generalize license and torrent services

- [ ] `[AUTO]` Acquire license for a VIDEO listing → succeeds
- [ ] `[AUTO]` Download torrent for a VIDEO listing → succeeds
- [ ] `[CODE]` Internal references renamed from "game" to "listing" in code (not DB)

### 7.7 — Server: Creator portal role generalization

- [ ] `[CODE]` "Developer" rebranded to "Creator" in UI text only
- [ ] `[CODE]` `DEVELOPER` enum value unchanged in DB/schema

### 7.8 — Client: Generalize types and stores

- [ ] `[CODE]` `ApiListing` type with `contentType` field exists
- [ ] `[CODE]` Type-specific metadata types defined (`GameMetadata`, `VideoMetadata`, `SoftwareMetadata`)
- [ ] `[CODE]` Old type names kept as aliases
- [ ] `[AUTO]` TypeScript compiles for client

### 7.9 — Client: Content-type-aware detail page

- [ ] `[CODE]` Detail page renders differently based on `contentType`
- [ ] `[CODE]` GAME: shows existing game UI (install, launch)
- [ ] `[CODE]` VIDEO: shows video player or download button
- [ ] `[CODE]` Route `/listing/:slug` exists (with `/game/:slug` redirect)
- [ ] `[MANUAL]` View a game detail page → unchanged behavior
- [ ] `[MANUAL]` View a video detail page → shows video-specific UI

### 7.10 — Client: Video playback with sequential download

- [ ] `[CODE]` Sequential downloading enabled for VIDEO content type
- [ ] `[CODE]` IPC channel `media:get-file-path` returns local file path
- [ ] `[CODE]` IPC channel `media:start-server` returns localhost URL for streaming
- [ ] `[MANUAL]` Download and play a video in the Electron client

### 7.11 — Client + Web + Dev-portal: UI generalization

- [ ] `[CODE]` Store page has category tabs/filters: All, Games, Videos, Software, Audio
- [ ] `[CODE]` Dev-portal "Create Game" → "Create Listing" with content type selector
- [ ] `[CODE]` "Developer Dashboard" → "Creator Dashboard" in UI text
- [ ] `[MANUAL]` Filter store by content type → correct results shown
- [ ] `[AUTO]` TypeScript compiles for web, client, dev-portal

### 7.12 — Dev-portal: Generalize upload flow

- [ ] `[CODE]` Content type selector at top of listing editor form
- [ ] `[CODE]` Conditional fields based on content type (exe path for games, video file for videos)
- [ ] `[CODE]` API calls use `/developer/listings` routes
- [ ] `[MANUAL]` Create a VIDEO listing from creator portal with .mp4 upload

---

## Phase 7 — Gate Check

- [ ] `[AUTO]` Games still work exactly as before
- [ ] `[AUTO]` Non-game content types can be created, uploaded, listed, purchased, downloaded
- [ ] `[AUTO]` Store filtering by content type works
- [ ] `[AUTO]` All TypeScript packages compile

---

## Phase 8: Progressive Decentralization

### 8.1 — Cryptographic identity: Key generation and storage

- [ ] `[CODE]` `client/src/main/keyManager.ts` exists with keypair generation, signing, import/export
- [ ] `[CODE]` `"keyPair"` in `STORE_KEY_WHITELIST`
- [ ] `[CODE]` IPC channels: `keys:generate`, `keys:get-public-key`, `keys:sign`, `keys:import-mnemonic`, `keys:export-mnemonic`
- [ ] `[AUTO]` **Generate + sign + verify:** Generate keypair → sign data → verify with public key → passes
- [ ] `[AUTO]` **Mnemonic round-trip:** Generate mnemonic → derive key → export mnemonic → import on fresh install → same public key
- [ ] `[CODE]` Private key encrypted at rest with user passphrase via scrypt + AES

### 8.2 — Key management UI in client

- [ ] `[CODE]` Settings page has "Identity & Keys" section
- [ ] `[CODE]` No key state: "Generate Identity" button → shows 12-word mnemonic with backup checkbox
- [ ] `[CODE]` Key exists state: shows truncated pubkey, export/import options
- [ ] `[MANUAL]` Generate identity in UI → mnemonic shown → can proceed after checkbox

### 8.3 — Server: Relay protocol — listing metadata API

- [ ] `[CODE]` `server/packages/relay/src/` has routes for `/relay/listings`, `/relay/listings/:id`, `/relay/info`, `/relay/creators`
- [ ] `[AUTO]` `GET /api/relay/listings` returns same listings as `/api/listings`
- [ ] `[AUTO]` `POST /api/relay/listings` with signed listing → accepted and stored
- [ ] `[AUTO]` `GET /api/relay/info` returns relay metadata (name, version, listing count)
- [ ] `[AUTO]` Unsigned listing submission → rejected

### 8.4 — Schema: Add relay/signature fields

- [ ] `[AUTO]` Migration applies cleanly
- [ ] `[CODE]` `Listing` model has `creatorPublicKey String?` and `signature String?`
- [ ] `[CODE]` `Relay` model exists: `id`, `url`, `name`, `lastSyncAt`, `status`, `trustedByDefault`
- [ ] `[CODE]` `FederatedListing` model exists (separate from local listings)
- [ ] `[AUTO]` Existing listings have null `creatorPublicKey` (pre-signing era)

### 8.5 — Server: Federation — subscribing to external relays

- [ ] `[CODE]` `server/packages/relay/src/federation.ts` handles inbound federation
- [ ] `[CODE]` Reads `FEDERATED_RELAYS` env var
- [ ] `[AUTO]` **Federation test:** Two server instances configured → listings propagate between them
- [ ] `[AUTO]` Signature verification on imported listings
- [ ] `[AUTO]` Admin API: `POST /admin/relays` (add), `DELETE /admin/relays/:id` (remove), `GET /admin/relays` (list)

### 8.6 — Client: Relay management UI

- [ ] `[CODE]` Relay list page in Electron client showing configured relays with status
- [ ] `[CODE]` "Add Relay" validates URL by fetching `/relay/info`
- [ ] `[CODE]` Default relay `boilerdeck.com` always present, cannot be removed
- [ ] `[CODE]` Relay list stored in Electron store under `relays`
- [ ] `[MANUAL]` Add a relay by URL → appears in list with status indicator

### 8.7 — Client: Multi-relay listing aggregation

- [ ] `[CODE]` In sovereign mode, store fetches from all enabled relays
- [ ] `[AUTO]` **Deduplication:** Same listing from two relays → shows once
- [ ] `[CODE]` Signature verification in renderer before displaying
- [ ] `[CODE]` Relay source badge on each listing
- [ ] `[MANUAL]` Add two relays with overlapping listings → no duplicates

### 8.8 — Relay server: Open-source packaging

- [ ] `[CODE]` `relay-server/` directory exists at repo root with `src/index.ts`, `prisma/schema.prisma`, `Dockerfile`, `README.md`
- [ ] `[AUTO]` `docker build` succeeds in `relay-server/`
- [ ] `[AUTO]` `docker run` → `/relay/info` returns valid response
- [ ] `[CODE]` No auth/payment/license code — only listing metadata + federation
- [ ] `[CODE]` MIT license file present

### 8.9 — Documentation: Running your own relay

- [ ] `[CODE]` `docs/relay-guide.md` exists with step-by-step setup instructions
- [ ] `[CODE]` Includes: system requirements, Docker instructions, env configuration, nginx example, systemd service, Tor hidden service
- [ ] `[MANUAL]` Follow the guide on a fresh environment → relay operational

### 8.10 — Client: Sovereign mode toggle

- [ ] `[CODE]` Settings toggle: "Sovereign Mode" on/off
- [ ] `[CODE]` ON: store aggregates from all relays, gateway treated as just another relay
- [ ] `[CODE]` OFF (default): all API calls through gateway
- [ ] `[CODE]` Warning text about features unavailable in sovereign mode
- [ ] `[CODE]` `settings.sovereignMode` in Electron store
- [ ] `[MANUAL]` Toggle sovereign mode → store fetches change source

### 8.11 — Resilience: Graceful gateway-down handling

- [ ] `[AUTO]` **Gateway failure → fallback:** Kill gateway → client shows banner and falls back to relay data
- [ ] `[CODE]` Locally installed content always accessible regardless of network
- [ ] `[CODE]` Cached listing data in Electron store for offline browsing
- [ ] `[CODE]` Torrent downloads continue without gateway (P2P)

### 8.12 — App distribution via BitTorrent

- [ ] `[CODE]` `scripts/create-installer-torrent.mjs` exists
- [ ] `[AUTO]` Script generates valid `.torrent` file for Electron installer
- [ ] `[AUTO]` Torrent downloadable via standard BitTorrent client → installer works
- [ ] `[CODE]` Concept documented for `APP_UPDATE` listing type

### 8.13 — Signed listing publishing flow (end-to-end)

- [ ] `[AUTO]` **Full flow:** Creator publishes listing in Electron → listing signed locally → submitted to gateway → gateway forwards to federated relays
- [ ] `[AUTO]` **Verifiable:** Any client can fetch the listing from any relay and verify the signature
- [ ] `[AUTO]` **Creator pubkey registered:** Creator's public key stored in `users` table and relay creator list
- [ ] `[AUTO]` **Signature persists:** Listing's `signature` and `creatorPublicKey` fields non-null in DB

---

## Phase 8 — Gate Check

- [ ] `[AUTO]` Relay server runs standalone and federates with gateway
- [ ] `[AUTO]` Sovereign mode works end-to-end (multi-relay aggregation)
- [ ] `[AUTO]` Gateway failure → client gracefully degrades
- [ ] `[AUTO]` Signed listings verifiable across relays
- [ ] `[AUTO]` All existing functionality preserved

---

## Cross-Phase Invariants (check after EVERY phase)

These must remain true throughout the entire implementation:

- [ ] `[AUTO]` `npx tsc --noEmit` passes for all packages (server, web, client, dev-portal)
- [ ] `[AUTO]` `npm install` from root exits 0
- [ ] `[AUTO]` Server starts without errors: `npm run dev:server` logs "listening on port..."
- [ ] `[AUTO]` Existing auth flow works: register → login → refresh → getMe → logout
- [ ] `[AUTO]` Existing game flow works: create → upload version → publish → list → detail
- [ ] `[AUTO]` Existing payment flow works: create checkout → complete → license granted
- [ ] `[AUTO]` No new `console.log` in production code (use proper logger if logging needed)
- [ ] `[AUTO]` No secrets committed: `.env` files remain gitignored, no hardcoded keys/passwords
- [ ] `[CODE]` ESM compliance: all new files use `.js` extensions in imports
