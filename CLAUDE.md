# BoilerDeck — Decentralized Game Distribution Platform

> **Start here:** Read `CONTEXT.md` for full project state, what's been built, known issues, and next steps.

## MANDATORY: Post-Implementation Workflow

**After writing or editing ANY code, you MUST complete ALL of these steps before ending your response. Do not stop, summarize, or ask the user what's next until every step is done.**

1. **Review:** Run `@server-reviewer` and/or `@frontend-reviewer` (based on what changed)
2. **Verify (code):** Run `@verify <sub-task-id>` (if working on a decentralization sub-task)
3. **Commit:** Stage and commit changes with a descriptive message
4. **Push:** `git push origin main`
5. **Deploy:** Pull on VPS, rebuild if needed, health check
6. **Verify (runtime):** After deploy, run ALL `[AUTO]` verification checks from `VERIFICATION_CHECKS.md` against the **live API** (`https://boilerdeck.com/api/...`). This means actually hitting endpoints with curl, checking Redis state via SSH, decoding JWTs, and confirming DB state — not just reading the code. Report a pass/fail table for every check.

If any step fails, fix the issue and retry. Do not skip steps. Do not ask the user whether to proceed — just do it.

## Project Structure
- `server/` — Node.js + TypeScript backend monorepo (Express, Prisma, PostgreSQL)
- `server/packages/` — Modular service packages (auth, catalog, license, payment, saves, torrent, shared, relay, locker)
- `server/prisma/` — Database schema and migrations
- `shared-ui/` — Shared frontend package (`@boilerdeck/ui-shared`) — API client core (token refresh, apiFetch, ApiError)
- `client/` — Electron + React desktop app (Vite, zustand, WebTorrent)
- `dev-portal/` — Developer dashboard SPA (Vite, React 19, Zustand, real API calls)
- `web/` — Public storefront SPA (Vite, React 19, HashRouter, real API calls)
- `docs/` — Documentation + handoff docs + archived specs

## Development
- **Server:** `npm run dev:server` from root (uses tsx watch)
- **Client (Electron):** `npm run dev:client` from root (starts both Vite dev server on port 5173 and Electron main process)
- **Client build:** `cd client && npm run build:electron` (Vite + tsc), then `../node_modules/.bin/electron-builder` (NSIS + portable → `client/release/`). Do NOT use `npx electron-builder` (resolves wrong version). See CONTEXT.md "Electron Build & Release Pipeline" for full details.
- **Client release:** Push a `v*` tag to trigger CI (`.github/workflows/build-client.yml`). **CI creates DRAFT releases** — you MUST publish with `gh release edit v0.x.x --draft=false` or auto-updater won't see it. See CONTEXT.md "Releasing a New Client Version" for full steps.
- **Dev Portal:** `npm run dev:portal` from root (Vite on port 5174, proxies /api to localhost:3001)
- **Web Storefront:** `npm run dev:web` from root (Vite on port 5173, proxies /api to localhost:3001)
- **Database:** `npm run db:migrate` (Prisma migrate), `npm run db:seed` (seed data)
- All packages use ESM (`"type": "module"`) — use `.js` extensions in imports

## Key Conventions
- Express routes use `try/catch` with `next(err)` pattern
- Input validation via Zod schemas — use `handleZodError` from `@boilerdeck/shared` (not a local copy)
- Auth via JWT (access + refresh tokens), `authenticate` middleware from `@boilerdeck/shared`
- Role checks via `requireRole("DEVELOPER")` etc.
- Error classes: AppError, NotFoundError, UnauthorizedError, ForbiddenError, ConflictError, ValidationError
- Stripe: import `getStripe` from `@boilerdeck/shared` (singleton in `shared/src/stripe.ts`) — never instantiate Stripe directly in packages
- Prisma models are PascalCase, DB tables are snake_case (via `@@map`)
- **Server error shape:** Server returns `{ error: { code, message } }`. All API clients parse errors as `body.error?.message || body.message || res.statusText`. Never assume `body.message` at the top level.
- **Helmet CORP:** Always initialize Helmet with `crossOriginResourcePolicy: { policy: "cross-origin" }` in `server/src/index.ts`. The default `same-origin` breaks Electron's `file://` renderer even when CORS is configured correctly.
- **Token rotation must be idempotent:** Use `deleteMany` instead of `delete` when rotating refresh tokens — React StrictMode double-fires effects and concurrent requests will both find the same token. `deleteMany` on an already-deleted token is a no-op; `delete` throws Prisma P2025.
- **Refresh calls must be serialized:** All API clients use a `refreshPromise` lock via `@boilerdeck/ui-shared` so only one `refreshAccessToken()` runs at a time. Concurrent callers await the same promise. Without this, concurrent 401s cause a race that invalidates the session.
- **Shared API client:** Token refresh, `apiFetch`, and `ApiError` live in `shared-ui/src/api-core.ts` (`@boilerdeck/ui-shared`). Each frontend's `api.ts` is a thin wrapper that provides a `TokenStorage` adapter (localStorage or IPC). Never duplicate token logic in individual frontends.
- **Catalog service split:** Listing CRUD is in `catalog/src/service.ts`, upload/zip processing is in `catalog/src/upload.ts`. Routes import from both. Old function names (`createGame`, `listPublishedGames`, etc.) exist as exported aliases.
- **Dual route system:** `/api/games` and `/api/listings` routes are both live and equivalent. `/api/developer/games` and `/api/developer/listings` likewise. New code should prefer `/listings` but both work.
- **Prisma model rename (Phase 7):** `Game` → `Listing`, `GameVersion` → `ListingVersion`, `GameStatus` → `ListingStatus` in Prisma. DB tables/columns unchanged via `@@map`. All `db.listing.*` calls (not `db.game.*`). FK fields still named `gameId` with `@map("game_id")`.
- **ContentType system:** `ContentType` enum (GAME, VIDEO, SOFTWARE, AUDIO, OTHER). Defaults to GAME. Exe detection skipped for non-GAME/SOFTWARE. Upload accepts zip + media files. Content type locked after listing creation.
- **Frontend component structure:** Large page components (GameEditor, GameDetail) are split into sub-components (GameEditorForm, UploadManager, ExeDetector). State stays in the page, sub-components receive props.
- **Role changes require token refresh:** Any endpoint that upgrades a user's role must be followed by `refreshAccessToken()` on the client. The existing JWT carries the old role claim until refreshed.
- **`GET /api/licenses` returns `{ licenses: [...] }`** — not a bare array. Always unwrap `data.licenses` and add `Array.isArray()` guard before calling array methods.
- **No DRM enforcement:** BoilerDeck distributes game builds as-is. There is no DRM system — developers handle their own copy protection before uploading. The license package only tracks ownership (who bought what). See CONTEXT.md "Copy Protection Philosophy" for details.
- **Nostr identity system (Phase 1 complete):** Every user has a secp256k1 keypair. Crypto module at `server/packages/auth/src/crypto.ts`. Pubkeys are immutable. Custodial users have encrypted privkey/mnemonic in DB (AES-256-GCM, format `v1:salt:nonce:tag:ciphertext`). Self-custody users only have pubkey stored. Signing keys cached in Redis encrypted with `SIGNING_CACHE_KEY`. See memory file `boilerdeck_decentralization.md` for full architecture summary.

## Relay Package Conventions (`server/packages/relay/`)
- **Package:** `@boilerdeck/relay` — owns ALL event-related endpoints and the WebSocket relay
- **WebSocket path:** `/relay` — NIP-01 protocol (REQ/EVENT/CLOSE → EVENT/EOSE/OK/NOTICE)
- **Live relay:** `wss://boilerdeck.com/relay` (nginx proxies with `Upgrade` headers, 24h timeout)
- **`fanOutEvent(event)`** is exported from `ws.ts` — call it when publishing events from REST endpoints (e.g., sign-and-publish) so WS subscribers get them
- **`federateOutbound(event)`** is called automatically in ws.ts EVENT handler — also call from REST publish paths if federation should include REST-published events
- **`isImported(eventId)`** prevents re-federation of imported events (loop prevention)
- **`initFederation()`** called in `server/src/index.ts` at startup — reads `EXTERNAL_RELAYS` env var (comma-separated WSS URLs)
- **NIP-11:** `GET /relay` with `Accept: application/nostr+json` returns relay info (handled by `nip11Router` mounted before error handler)
- **Key management routes:** `GET /api/relay/me/keys` (export), `POST /api/relay/me/import-key` (import) — both authenticated
- **Sign-and-publish:** `POST /api/events/sign-and-publish` — server signs with user's Redis-cached key, stores, fans out, federates
- **Subscription limits:** Max 20 per connection, max sub ID 128 chars, max 10 filters per REQ
- **Message limits:** 1MB max WebSocket frame, 1MB max event content, 1000 max tags
- **Filter matching supports:** `ids` (prefix), `authors` (prefix), `kinds`, `since`, `until`, `#e`, `#p` tag filters — DB handles basic fields, in-memory handles tag/id/author prefix matching

## Social & Reputation Conventions (Phase 4+5)
- **Review events (kind 31337):** Parameterized replaceable on `d` tag (game slug). One review per user per game. Requires license ownership (403 without). Content is JSON `{ rating, title, body }`.
- **Attestation events (kind 31338):** Parameterized replaceable on `d` tag (infoHash). `p` tag = developer pubkey (NOT seed box's own pubkey). Self-attestation rejected. bytesDownloaded validated against torrent file size.
- **Kind validation:** All event kinds validated in `relay/src/kinds.ts` — called from both REST `POST /events` and WebSocket `EVENT` handler. Async DB validation (infoHash lookup) in `attestationValidation.ts`.
- **Reputation scoring:** Logarithmic formula in `relay/src/reputation.ts`. Anti-sybil: accounts < 7 days = 0.1x, max 20 attestations per attester per day. Redis cached (15min TTL).
- **Web of trust:** `GET /api/reputation/:pubkey?viewer=<viewerPubkey>` returns personalized score. Follow = 1.0x, unknown = 0.25x, muted = 0x.
- **Mute list:** Stored in Redis set `mute:{userId}`. WS fan-out filters muted pubkeys asynchronously.
- **Profile/follow events:** Regular replaceable (kind 0, 3) — one per pubkey. Extended `shared/src/events.ts` with `isRegularReplaceableKind()`.
- **Electron client local signing:** Reviews signed locally via cached privkey + `@noble/curves` Schnorr, published via relay WebSocket. IPC channels: `events:sign-and-publish-review`, `events:cache-relay-keys`.
- **Attestation auto-publish:** `client/src/main/attestation.ts` called from torrent `done` handler. Non-fatal (`.catch()`). Uses `developerPubkey` from download metadata.
- **VPS seed attestation:** `scripts/seed-attestation-cron.ts` — standalone script, reads `VPS_SEED_PRIVKEY` env var, queries Transmission RPC.
- **Game detail infoHash:** `latestVersion` in game detail API includes `infoHash` (via Prisma join through version→torrent). Used by TopSeedersSection to filter attestations.

## Social Feed Conventions (web storefront)
- **Social page** (`web/src/pages/Social.tsx`): Two sub-tabs (For You / Following), state via `useState<Tab>`. For You = `GET /api/events?kinds=1&limit=30`. Following = fetch follows first, then filter events by `authors=<csv>`.
- **Profile cache**: `useRef<Map<string, ProfileData>>` + `profileVersion` counter to trigger re-renders. Batch-fetch via `Promise.allSettled` to avoid one failure breaking all profiles.
- **Pagination**: Cursor-based via `until=<oldest_created_at>`. Deduplication on merge (Set of event IDs) because `until` may be inclusive.
- **Compose**: `POST /api/events/sign-and-publish` with `{ kind: 1, content, tags: [] }`. Server signs with user's Redis-cached key. New event prepended to feed on success.
- **PostCard** (`web/src/components/PostCard.tsx`): Receives `event`, `authorName?`, `authorPicture?`. Links author name to `/profile/:pubkey`. Uses `formatRelativeTime()` from `utils.ts`.
- **ComposeBox** (`web/src/components/ComposeBox.tsx`): Textarea + Post button. Calls `onPost(event)` callback. Only rendered when logged in.
- **ProfileData consolidated** in `web/src/types.ts` — do NOT re-declare locally in page components.
- **Deferred features**: reply counts, like/reaction button, inline threading, real-time WS updates, client-side signing (Phase 8).

## Electron Client Conventions
- **IPC handlers** go in `client/src/main/index.ts` `setupIpcHandlers()` — namespaced like `store:get`, `downloads:start`, `games:launch`
- **Preload bridge** at `client/src/main/preload.ts` — every IPC channel must be exposed here under `window.boilerdeck`
- **Type declarations for `window.boilerdeck`** must be kept in sync in TWO places: `preload.ts` (declare global) and `client/src/renderer/env.d.ts`
- **Renderer stores** follow the same Zustand patterns as web storefront — select data, compute inline, no function selectors for display state
- **Refresh tokens** stored via IPC `store:get/set` (JSON file), NOT localStorage (Electron has no persistent localStorage across builds)
- **Shell links** restricted to `https://` only in the `shell:open-external` handler (security)
- **Download metadata** stored in module-level Map, not in Zustand (avoids re-render churn)
- **WebTorrent download path** is `installDir` (NOT `installDir/slug`) — WebTorrent creates the torrent root folder automatically. The install path (for game registry) is `installDir/slug`.
- **Torrent destroyed after download** — `torrent.destroy({ destroyStore: false })` releases file handles so the exe can be launched. The client does not seed after download.
- **Exe path is relative** to the game's torrent root directory (e.g., `PeerPlayBuild/Game.exe`). The client joins `installPath + exePath` to get the full path. Detection is recursive (walks subdirs).
- **Native deps** (like `utp-native` for WebTorrent): must be in `asarUnpack` in electron-builder config
- **Dev mode: kill stale Electron processes** — `taskkill //F //IM electron.exe` before relaunching. Zombie processes hold WebTorrent file locks causing EBUSY.
- **Game launch is direct** — `installedStore.launch()` spawns the exe immediately. No license verification or DRM checks at launch time.
- **ESM-only packages in asar — MUST use dynamic import():** The main process compiles to CJS (`require()`). ESM-only npm packages (those with `"type": "module"` and only `"import"` in their `exports` map) work on a real filesystem via Node 22's `require(esm)`, but **crash inside Electron's asar** with "No 'exports' main defined". Fix: use `await import("package-name")` instead of static `import`. This applies to `socks-proxy-agent@9`, `agent-base@8`, and any future ESM-only dependency used in the main process. See `proxyManager.ts` for the pattern.

### Electron Dev Workflow — CRITICAL
**After modifying ANY file in `client/src/main/` (including `preload.ts`), you MUST recompile before launching Electron:**
```bash
cd client && npx tsc -p tsconfig.main.json
```
The renderer (React) hot-reloads via Vite automatically, but the main process and preload are compiled TypeScript — changes won't take effect until recompiled. The compiled output lives at `client/dist/main/`. Vite's `--noEmit` type-check does NOT produce this output. **This is the #1 source of "it works in source but crashes at runtime" bugs.**

**Full local dev launch (from project root):**
```bash
# Option 1: Use the batch file (kills stale processes, starts Vite, waits, launches Electron)
./dev-client.bat

# Option 2: Manual (if you need to recompile first)
taskkill //F //IM electron.exe 2>/dev/null          # kill zombies
cd client && npx tsc -p tsconfig.main.json           # recompile main process
cd .. && npm run dev:client                           # start Vite (terminal 1)
cd client && ../node_modules/.bin/electron .          # launch Electron (terminal 2)
```
**Note:** `dev-client.bat` does NOT recompile the main process. If you changed main process files, run `tsc` manually first.

### Electron IPC Safety Rules
- **All async IPC handlers MUST have try/catch.** Unhandled rejections in the main process surface as Electron error dialogs that crash the user experience. Pattern:
  ```typescript
  ipcMain.handle("channel:name", async (_event, args) => {
    try {
      return await doWork(args);
    } catch (err) {
      console.error("[channel] error:", err);
      throw err; // or return { success: false }
    }
  });
  ```
- **React StrictMode double-fires effects.** Any IPC call triggered from a `useEffect` will run twice in dev: mount → cleanup → mount. If the IPC starts a stateful resource (WebSocket, sync connection), the `start` function must call `stop` first to be idempotent. Cleanup functions must handle "not yet initialized" gracefully (try/catch around `.close()`).
- **WebTorrent operations need scaled timeouts + settled guards.** Hashing a 1GB file takes ~30s. Use `30_000 + Math.ceil(fileSize / (1024*1024*1024)) * 30_000` for timeouts. Always use a `let settled = false` flag to prevent timeout/ready race conditions that cause "client already destroyed" errors.

### Electron Self-Custody Locker Rules
- **Self-custody uploads bypass the server API entirely.** The flow is: hash file → create torrent locally → encrypt metadata (NIP-44) → sign Nostr event → publish to relay → (optional) upload raw file to VPS for seeding.
- **Always save to local index immediately** (`lockerStore.upsertEntry()` + `emitSyncUpdate()`) after creating an entry. Do NOT rely on the relay round-trip to persist entries — the relay may be down or slow. The local index is the source of truth for the UI.
- **File data is never encrypted.** Only the LockerEntry metadata JSON (filename, infoHash, tags, etc.) is NIP-44 encrypted. The file itself is stored/seeded as-is via BitTorrent.

## Locker Package Conventions (`server/packages/locker/`)
- **Package:** `@boilerdeck/locker` — personal encrypted file storage (upload, list, delete, share, health)
- **Routes:** Mounted at `/api/locker` — all routes except `/health` require JWT auth
- **Encryption:** NIP-44 via `@boilerdeck/auth` (`nip44Encrypt`, `nip44Decrypt`). Content is self-encrypted (user's own pubkey). Sharing re-encrypts to recipient's pubkey.
- **Event kind:** 30078 (NIP-78 application-specific data). Parameterized replaceable with `d`-tag = entry UUID.
- **Quota:** DB-tracked via `LockerQuota` model. Default 50 GB per user. Check before upload, increment/decrement on upload/delete. Decrement floors at zero.
- **Dedup:** SHA-256 content-addressed. `findDuplicate()` checks for existing file with same hash. Second upload reuses existing torrent (same infoHash).
- **Storage:** Files at `LOCKER_DIR/<userId>/<entryId>/<filename>`. Torrent at `<entryId>.torrent` in same dir.
- **Soft delete:** `deletedAt` timestamp on `LockerFile`. NIP-09 deletion event published. Cleanup via cron after retention period.
- **Seed manager:** `seedManager.ts` queries Transmission RPC for locker torrent stats, pauses deleted, removes expired.
- **Config:** `config.ts` reads `LOCKER_DIR`, `LOCKER_MAX_FILE_SIZE`, `LOCKER_QUOTA_GB`, `LOCKER_RETENTION_DAYS`, `LOCKER_MAX_STORAGE_GB` from env.
- **Security:** See `docs/locker-security.md` for full threat model. Self-custody users' metadata is E2E encrypted. Custodial users trust the server.

## Deployment to VPS
Everything runs on a single Hetzner VPS (`boilerdeck.com` / `204.168.133.38`). HTTPS via Let's Encrypt (auto-renews). Deploy process:
```bash
# 1. Commit and push locally
git add <files> && git commit -m "message" && git push origin main

# 2. SSH pull + install + rebuild
ssh root@204.168.133.38 "cd /opt/boilerdeck && git pull origin main && npm install"

# 3. Rebuild frontends (only if changed)
ssh root@204.168.133.38 "cd /opt/boilerdeck && npx vite build web"         # storefront
ssh root@204.168.133.38 "cd /opt/boilerdeck && npx vite build dev-portal"  # dev portal

# 4. Restart server (only if backend changed)
ssh root@204.168.133.38 "systemctl restart boilerdeck"
```
**Gotcha:** If VPS has local changes, `git pull` will fail — use `git stash --include-untracked` first.
**Gotcha:** `package-lock.json` from Windows may lack `@rollup/rollup-linux-x64-gnu`. If Vite build fails on VPS, run `npm install @rollup/rollup-linux-x64-gnu` or do a clean `rm -rf node_modules && npm install`.
**Gotcha:** After wiping `node_modules` on VPS, run `npx prisma generate` before `systemctl restart boilerdeck`.
**Gotcha:** Electron dev mode runs the renderer on `http://localhost:5173` (Vite), not `file://`. VPS `.env` must include `CORS_ADDITIONAL_ORIGINS="http://localhost:5173"` or API calls will be blocked in dev mode.
**Nginx downloads block:** The `/downloads/` location in `/etc/nginx/sites-available/boilerdeck` serves from `/opt/boilerdeck/downloads/` with `Content-Disposition: attachment`.
**Gotcha:** `/opt/boilerdeck/downloads/` may not exist after VPS rebuild — `mkdir -p` before SCP.
**Gotcha:** GitHub Release assets use hyphens (`BoilerDeck-Setup-0.2.0.exe`) but the VPS download links use URL-encoded spaces (`BoilerDeck%20Setup%200.2.0.exe`). Must rename when SCP-ing: `scp /tmp/BoilerDeck-Setup-X.Y.Z.exe "root@204.168.133.38:/opt/boilerdeck/downloads/BoilerDeck Setup X.Y.Z.exe"`
**Release process:** See CONTEXT.md "Releasing a New Client Version" for the full step-by-step (bump version → commit → tag → CI → download → SCP → rebuild web).

## Agents (`.claude/agents/`)

| Agent | Trigger | What it does |
|-------|---------|-------------|
| `feature-coordinator` | `@feature-coordinator {description}` | Produces a cross-cutting implementation plan identifying every file/layer that needs changes, in dependency order |
| `deploy` | `@deploy` | Handles full deploy to VPS — pre-flight checks, pull, build, restart, health verification |
| `server-reviewer` | `@server-reviewer` | Reviews recent server code changes for convention compliance, security, and BoilerDeck-specific gotchas |
| `frontend-reviewer` | `@frontend-reviewer` | Reviews recent frontend changes across web, dev-portal, and client for correctness and patterns |
| `verify` | `@verify <sub-task-id>` | Runs verification checks from `VERIFICATION_CHECKS.md` for a specific sub-task. Reports pass/fail for each check. Read-only — does not modify code. |

### Recommended Workflow

1. **Plan:** `@feature-coordinator {what to build}` — get a cross-cutting implementation plan before writing code
2. **Build:** Implement the feature (main conversation)
3. **Review:** `@server-reviewer` and/or `@frontend-reviewer` — catch issues before committing
4. **Ship:** Commit, push, then `@deploy` to get changes live on the VPS

### Design Philosophy
- **Feature coordinator plans, main conversation builds.** Most BoilerDeck features cut across layers (schema → server → frontend → infra). The coordinator identifies all touchpoints; the main conversation does the actual implementation because cross-cutting changes need tight coordination, not isolated subagents.
- **Reviewers catch, not block.** Run reviewers after writing code to catch convention drift and gotchas. They review only changed files.
- **Deploy agent automates the manual SSH flow.** It figures out what changed, only rebuilds what's needed, and verifies health after.

## Adding Games to the Platform

**Full pipeline for uploading new games:**

1. **Download** portable Windows zip builds into `game-staging/`
2. **Download** cover images into `game-staging/covers/` (jpg/png/webp, from official sites)
3. **Create manifest** at `game-staging/manifest.json` — array of game objects:
   ```json
   [{ "zipFile": "game.zip", "coverFile": "covers/game.jpg", "title": "Game Name",
      "description": "...", "version": "1.0.0", "priceCents": 0 }]
   ```
4. **Tell the user to run** (Claude cannot run this — requires credentials):
   ```bash
   node scripts/upload-games.mjs <email> <password>
   ```
5. **Re-seed torrents on VPS** (upload pipeline's `addToTransmission` is fire-and-forget, often silently fails for large torrents):
   ```bash
   ssh root@204.168.133.38 'bash -s' < scripts/reseed-torrents.sh
   ```

**Key scripts:**
- `scripts/upload-games.mjs` — Creates game + version + uploads zip + uploads cover + publishes. Reads from `game-staging/manifest.json` (or custom path as 3rd arg).
- `scripts/upload-covers.mjs` — Uploads covers for existing games (matches by title substring).
- `scripts/publish-all-drafts.mjs` — Publishes all DRAFT games.
- `scripts/reseed-torrents.sh` — Re-adds all published game torrents to Transmission. Run on VPS via SSH.

**Gotchas:**
- Upload limit is **2 GB** (multer config). Games larger than this cannot be uploaded.
- The publish endpoint is `PATCH /developer/games/:id/publish` (not POST).
- Games are created in `DRAFT` status — must be explicitly published.
- Transmission doesn't persist torrents across restarts — always re-seed after uploading.
- Base64 torrent data can exceed bash arg limits — the reseed script uses temp files + python to avoid this.
- Only games with a `.exe` inside the zip can be uploaded (exe auto-detection is required).
- Java-only games (`.jar`) won't work — no `.exe` to detect.
- The `game-staging/` directory is **gitignored** (contains multi-GB game zips).

**Good sources for free redistributable games:** Open-source games with GPL/MIT/zlib licenses and portable Windows zip builds. Check GitHub releases for portable zips. Avoid: installer-only games, Java-only games, games > 2 GB.

## Environment
- Copy `server/.env.example` to `server/.env` and configure
- Requires PostgreSQL and Redis running locally (or connection strings to remote instances)
