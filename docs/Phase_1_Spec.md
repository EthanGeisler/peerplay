# Phase 1: Keypair Identity System — Archived Spec

> **Status:** COMPLETE (13/13 sub-tasks). This file preserves the original sub-task specifications for reference.
> **Handoff docs:** See `docs/handoff/1.1.md` through `docs/handoff/1.13.md` for what was actually built.
> **Active plan:** See `DECENTRALIZATION_PLAN.md` for Phase 2+ specs.

---

**Goal:** Replace email/password as the *underlying* identity while keeping it as the UX surface. Every account gets backed by a **secp256k1 keypair** (Nostr-compatible). Users don't notice unless they want to.

**Crypto stack:** `@noble/curves` (secp256k1 + Schnorr), `@noble/hashes` (SHA-256), `@scure/bip39` (mnemonics), `@scure/bip32` (NIP-06 key derivation), `@scure/base` (hex/bech32 encoding)

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
