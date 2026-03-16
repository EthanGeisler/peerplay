# BoilerDeck — Project Context

> Read this first every session. This file captures the current state of the project so future Claude instances can pick up where the last one left off.

---

## What Is BoilerDeck?

A **Steam competitor** that uses **BitTorrent for game file distribution** with a lightweight centralized backend for auth, payments, and metadata.

**Key value props:**
- **99/1 revenue split** (developer/platform) — made possible by zero CDN costs (BitTorrent)
- **Developer-choice DRM** — None, Light (online check), or Encrypted (AES-256-CTR)
- **Open-source client** (MIT), proprietary server
- Future: Steam library integration, cloud saves, Bitcoin Lightning payments

**Live URLs:**
- **Storefront:** https://boilerdeck.com/ (VPS, nginx + Let's Encrypt SSL)
- **Developer Portal:** https://boilerdeck.com/dev/
- **API:** https://boilerdeck.com/api/health
- **GitHub Pages (legacy):** https://ethangeisler.github.io/peerplay/ — still auto-deploys but storefront is now served from VPS

---

## What Has Been Built (MVP v0.1)

### Server — Express + TypeScript monorepo (`server/`)

Fully functional REST API running on port **3001** (port 3000 is used by open-webui Docker container on this machine).

**Packages** (`server/packages/`):
| Package | What it does | Key files |
|---------|-------------|-----------|
| `shared` | Prisma client, middleware (auth, role check, error handler), config (Zod-validated env), Redis client, error classes, Stripe singleton | `src/db.ts`, `src/middleware.ts`, `src/config.ts`, `src/errors.ts`, `src/redis.ts`, `src/stripe.ts` |
| `auth` | JWT auth (access 15m + refresh 7d with rotation), bcrypt password hashing, user registration/login, **Stripe Connect onboarding** (account creation + account links, Redis-backed one-time tokens for return/refresh URLs) | `src/service.ts`, `src/routes.ts`, `src/developer.routes.ts` |
| `catalog` | Game CRUD, slug generation, paginated listing, game detail, **file upload pipeline** (zip extraction, torrent creation, Transmission seeding, exe auto-detection) | `src/service.ts`, `src/routes.ts` |
| `license` | License listing, verification with device fingerprinting (max 3 devices), decryption key delivery for ENCRYPTED tier, device deregistration. Crypto utils for AES-256-GCM key wrap/unwrap and HKDF per-user key derivation. | `src/service.ts`, `src/routes.ts`, `src/crypto.ts` |
| `payment` | **Real Stripe Checkout** — free games: atomic license grant; paid games: Stripe Checkout Session with Connect destination charges, platform fee (1%), webhook handlers for `checkout.session.completed`/`expired`/`account.updated`, idempotent payment+license creation, orphaned payment cleanup on Stripe failure | `src/service.ts`, `src/routes.ts` |
| `torrent` | Torrent retrieval with license ownership check, **`createGameTorrent()` for generating .torrent files** (used by catalog upload pipeline) | `src/service.ts`, `src/routes.ts`, `src/vendor.d.ts` |
| `saves` | Cloud save upload/download — **scaffolded but not implemented** | `src/index.ts` |

**Database:** PostgreSQL 16 via Prisma ORM (`server/prisma/schema.prisma`)
- 10 models: User, RefreshToken, Developer, Game, GameVersion, Torrent, EncryptionKey, License, Payment, SaveFile
- 6 enums: UserRole, GameStatus, VersionStatus, DrmTier, LicenseStatus, PaymentStatus
- All models use `@@map("snake_case")` for DB table names, PascalCase in code
- BigInt columns (fileSizeBytes, sizeBytes) need `BigInt.prototype.toJSON` patch (in `shared/src/db.ts`)

**Seed data** (`server/prisma/seed.ts`):
- Admin: `admin@boilerdeck.com` / `admin123456`
- Developer: `dev@example.com` / `developer123` (studio: "Indie Games Studio")
- Player: `player@example.com` / `player123456`
- 3 sample games (Space Explorer $19.99, Dungeon Crawl $9.99, Pixel Racing Free)
- Player Character 01 — Premium Edition ($9.99, LIGHT DRM)

**Player Character 01** was also published to the DB via `scripts/publish-game.mjs`:
- Game slug in DB: `player-character-01-43dc` (the hex suffix is random, will differ after re-seed)
- Has a GameVersion (v0.1.0, 96MB) + Torrent record with magnet URI

**API endpoints (all verified working):**
- `POST /api/auth/register|login|refresh|logout`, `GET /api/auth/me`
- `GET /api/games`, `GET /api/games/:slug`
- `POST /api/developer/register`, `GET /api/developer/stripe/onboard`, `GET /api/developer/stripe/return?token=...`, `GET /api/developer/stripe/refresh?token=...`, `GET /api/developer/me`
- `POST /api/developer/games`, `PUT /api/developer/games/:id`
- `POST /api/developer/games/:id/versions`
- `POST /api/developer/games/:id/versions/:versionId/upload` (multipart, `gameZip` field, 2GB limit, 30min timeout)
- `GET /api/licenses`, `POST /api/licenses/:gameId/verify` (with device fingerprinting)
- `POST /api/licenses/:gameId/key` (ENCRYPTED DRM — decryption key delivery)
- `DELETE /api/licenses/:gameId/devices/:fingerprint` (device deregistration)
- `POST /api/payments/checkout`, `POST /api/payments/webhook`
- `GET /api/torrents/:gameId/latest` (includes `encrypted` flag + `algorithm` for encrypted games)
- `GET /api/health`

### Web Storefront — Vite + React 19 (`web/`)

SPA served from VPS at `/`. Uses **HashRouter**. Talks to the **real API** (not mock data). Also still deploys to GitHub Pages via Actions but the primary URL is now the VPS. Header includes a "Developer Portal" link to `/dev/`.

**Pages** (`web/src/pages/`):
- `Store.tsx` — Featured hero (first game in DB) + game grid cards with DRM tier badges. Fetches real games from `GET /api/games`.
- `GameDetail.tsx` — Full detail page with DRM info card, purchase button (real checkout via `POST /api/payments/checkout`), torrent download link after purchase (via `GET /api/torrents/:gameId/latest`), revenue split breakdown, version info
- `Library.tsx` — Owned games from real licenses (`GET /api/licenses`). Links to `/login` for unauthenticated users.
- `Login.tsx` — Login/Register form with tabs. JWT auth via `POST /api/auth/login|register`.
- `About.tsx` — Platform explainer (revenue split, BitTorrent, 3-column DRM tier comparison cards, tech stack)
- `CheckoutSuccess.tsx` — Post-purchase page. Polls `fetchLicenses()` until new license appears (webhook latency). Handles unauthenticated users with sign-in prompt.
- `CheckoutCancel.tsx` — Shown when user cancels Stripe Checkout. Links back to store.

**State:** Three Zustand stores (split by concern):
- `web/src/stores/authStore.ts` — Login, register, logout, session restore via refresh token. On mount, `loadSession()` tries to restore session from `pp_refresh_token` in localStorage.
- `web/src/stores/gameStore.ts` — `fetchGames()` (listing) and `fetchGameBySlug()` (detail page)
- `web/src/stores/libraryStore.ts` — `fetchLicenses()`, `checkout()`, `fetchTorrent()`. No `isOwned` function — components select the `licenses` array directly and compute ownership inline (see Zustand gotcha below).

**API client:** `web/src/api.ts` — `apiFetch()` with JWT auto-refresh on 401, `ApiError` class, 204 handling. Copied from dev-portal's `api.ts` (minus `apiUpload()`). `refreshAccessToken()` is exported and reused by authStore's `loadSession`.

**Types:** `web/src/types.ts` — TypeScript interfaces matching actual server response shapes: `ApiGame`, `ApiGameDetail`, `ApiUser`, `ApiAuthResponse`, `ApiLicense`, `ApiTorrent`, `ApiCheckoutResult`, `ApiGameListResponse`.

**Shared utils:** `web/src/utils.ts` — `formatPrice()`, `formatSize()`, `PLACEHOLDER_COVER` constant. Used by Store, GameDetail, Library.

**Key differences from mock era:**
- No more `editions` concept (DB has single `priceCents`/`drmTier` per game, no edition picker)
- No more `tags` (DB Game model has no tags column)
- No more `featured` flag (first game in listing is used as hero)
- No more `releaseDate`, `fileSizeMB`, `version` on listing cards (only available in detail endpoint via `latestVersion`)
- `coverImageUrl` and `screenshots` may be null/empty for seeded games — all `<img>` tags use fallback placeholders

**Auth flow:**
1. User clicks "Sign In" → navigates to `/#/login`
2. Login form calls `POST /api/auth/login` → gets `{ user, accessToken, refreshToken }`
3. Access token stored in memory (`api.ts` module var), refresh token in `localStorage` key `pp_refresh_token`
4. On page reload, `loadSession()` calls `refreshAccessToken()` (exported from `api.ts`) then `GET /api/auth/me`
5. `pp_refresh_token` localStorage key is shared with dev-portal (same origin) — acts as SSO
6. Logout sends refresh token in body so server revokes it in DB

**Deployment:** Served from VPS via nginx (`/opt/boilerdeck/web/dist`). GitHub Actions still deploys to Pages (`.github/workflows/deploy.yml`) but that's now legacy.

**Vite config:** `base: "/"`, dev proxy: `/api` → `http://localhost:3001` (for local development).

### Developer Portal — Vite + React 19 (`dev-portal/`)

SPA served from VPS at `/dev/`. Talks to the real API. Login with developer credentials.

**Pages** (`dev-portal/src/pages/`):
- `Login.tsx` — Email/password login
- `SetupDeveloper.tsx` — First-time developer profile creation + Stripe Connect onboarding prompt (uses shared `redirectToStripeOnboard()`)
- `Dashboard.tsx` — Lists developer's games with version/license counts. Shows Stripe onboarding banner if not connected, payouts-pending notice if connected but payouts disabled, "Stripe Connected" badge when fully set up.
- `GameDetail.tsx` — Full game management: publish/unpublish, version list with torrent info, **file upload** (drag-and-drop zip → progress bar → processing → READY)
- `GameEditor.tsx` — Create/edit game form. **Creating a game requires uploading a zip** (version + zip fields). Exe auto-detected from upload.

**Upload flow (end-to-end):**
1. Frontend: `POST /developer/games` → creates game
2. Frontend: `POST /developer/games/:id/versions` → creates version (PROCESSING status)
3. Frontend: `POST /developer/games/:id/versions/:versionId/upload` → uploads zip via `apiUpload()` (XHR with progress)
4. Server (catalog service `uploadAndProcessVersion`): extracts zip → calculates size → auto-detects exe → calls `createGameTorrent()` → creates Torrent DB record → updates version to READY → adds torrent to Transmission via RPC → cleans up temp zip
5. Transmission RPC (`addToTransmission`): POST to `http://127.0.0.1:9091/transmission/rpc`, handles 409 CSRF dance, base64 metainfo, non-blocking (failure logged but doesn't block upload)

**Key files:**
- `dev-portal/src/api.ts` — `apiFetch()` (fetch + auth refresh) + `apiUpload()` (XHR with progress callback) + `redirectToStripeOnboard()` (shared Stripe Connect redirect helper)
- `dev-portal/vite.config.ts` — `base: "/dev/"` for VPS subpath

**Vite config:** `base: "/dev/"` — **must match the nginx alias path** or assets 404.

### Electron Client — scaffolded (`client/`)

Desktop app structure exists but is **not fully functional** yet:
- `src/main/index.ts` — Electron main process with IPC handlers, hidden torrent BrowserWindow
- `src/main/preload.ts` — contextBridge for secure IPC
- `src/renderer/` — React SPA with pages (Store, Library, Downloads, Settings)
- `src/renderer/api.ts` — Fetch wrapper with auto 401 refresh retry
- `src/renderer/stores/authStore.ts` — Zustand auth store pointing at localhost:3001
- `src/renderer/stores/downloadStore.ts` — Zustand download tracking

The Electron client connects to the real API but WebTorrent integration in the hidden renderer is stubbed.

### Scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `create-game-torrent.mjs` | Creates .torrent file from a game directory |
| `parse-torrent.mjs` | Parses .torrent to extract info hash + magnet URI |
| `publish-game.mjs` | Publishes a game in the DB (sets PUBLISHED, creates Torrent + GameVersion records) |
| `encrypt-game.mjs` | Encrypts game files with AES-256-CTR, wraps master key with DRM_MASTER_KEK, outputs wrapped key hex + manifest |
| `publish-game-encrypted.mjs` | Publishes an encrypted game (creates EncryptionKey record, sets drmTier ENCRYPTED, creates Torrent + GameVersion) |
| `player-character-01.torrent` | Generated torrent file for PC01 (8KB) |
| `player-character-01.magnet.txt` | Magnet URI for quick reference |

---

## Infrastructure

### Production VPS (Hetzner CX23) — `boilerdeck.com` (`204.168.133.38`)

The production environment runs on a Hetzner VPS. All services auto-start on boot. HTTPS via Let's Encrypt (auto-renews, cert at `/etc/letsencrypt/live/boilerdeck.com/`).

| Service | Details |
|---------|---------|
| **Nginx** | Ports 80 (→301 HTTPS) + 443 (SSL). `/` → `web/dist`, `/dev/` → `dev-portal/dist`, `/api/` → proxy to Node 3001. `client_max_body_size 2g` on `/api/`. |
| **BoilerDeck API** | systemd service `boilerdeck`, Node/tsx on port 3001 |
| **PostgreSQL 16** | User: `peerplay`, DB: `peerplay`, localhost:5432 |
| **Redis 7** | localhost:6379 |
| **Transmission** | BitTorrent seeder on port 6881. RPC at `http://127.0.0.1:9091/transmission/rpc`. Upload pipeline auto-adds torrents via RPC. |

**SSH access:** `ssh root@204.168.133.38` (key: `~/.ssh/id_ed25519` on dev machine)

**Project location on VPS:** `/opt/boilerdeck/`
**Game files on VPS:** `/opt/boilerdeck/games/<game-slug>/` (created automatically by upload pipeline)
**Upload temp dir:** `/opt/boilerdeck/games/.tmp/` (auto-created by multer on first upload)
**Torrent file on VPS:** Stored in DB as `Torrent.torrentFile` (Bytes column), no longer loose files
**Nginx config:** `/etc/nginx/sites-available/boilerdeck`
**Note:** PostgreSQL DB/user are still named `peerplay` — renaming would require a migration.
**VPS .env:** `/opt/boilerdeck/server/.env` (includes `TRANSMISSION_RPC_URL`)

**VPS management commands:**
```bash
# Check API
curl https://boilerdeck.com/api/health

# Check seeder status
ssh root@204.168.133.38 "transmission-remote -l"

# Check seeder peers/trackers
ssh root@204.168.133.38 "transmission-remote -t 1 -it"

# Restart API
ssh root@204.168.133.38 "systemctl restart boilerdeck"

# Restart Transmission seeder
ssh root@204.168.133.38 "pkill transmission; sleep 1; nohup transmission-daemon --config-dir /root/.config/transmission-daemon > /var/log/transmission.log 2>&1 &"
```

**Firewall (UFW):** SSH, 80/443, 6881-6889 TCP+UDP, 30000-65535 TCP+UDP

### Local Development

**Local services (for dev only, not required if using VPS):**
- **PostgreSQL 16** — Docker container `peerplay-postgres` on port 5432 (user: postgres, pass: postgres, db: peerplay)
- **Redis 7** — Docker container `peerplay-redis` on port 6379

**Start commands:**
```bash
# Start local databases (if not already running)
docker start peerplay-postgres peerplay-redis

# Run migrations + seed (only needed on fresh setup or schema changes)
cd /c/Users/eface/peerplay && npm run db:migrate && npm run db:seed

# Start API server locally
npm run dev:server    # runs on port 3001

# Start web dev server (for local development, not needed if using GH Pages)
npm run dev:web       # runs on port 5173
```

**Environment:** `server/.env` — contains DATABASE_URL, REDIS_URL, JWT secrets, Stripe keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PLATFORM_FEE_PERCENT`), `CORS_ORIGIN`, port config, optional `DRM_MASTER_KEK` (64+ hex chars, required for ENCRYPTED DRM tier). Not committed to git. Separate `.env` exists on VPS at `/opt/boilerdeck/server/.env`.

---

## Player Character 01 — The First Real Game

- **Source:** `C:\Users\eface\player-character-01\build\PeerPlayBuild\`
- **Executable:** `PLAYER_CHARACTER_01PeerPlay.exe`
- **Size:** ~101MB (3 files: exe, console exe, pck)
- **Active info hash:** `bf69c35df8f0d24cdacfdf3f10c7afdc4513b09e` (from `mktorrent` on VPS — this is the one in use)
- **Featured** on the web storefront (first game returned by `GET /api/games`)
- **DRM:** None (free, DRM-free)
- **Seeded from:** VPS via Transmission daemon on `204.168.133.38:6881`

**Magnet URI (current, working):**
```
magnet:?xt=urn:btih:bf69c35df8f0d24cdacfdf3f10c7afdc4513b09e&dn=player-character-01&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Fexplodie.org%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969%2Fannounce&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce
```

**Important torrent lessons:**
- **Do NOT use WebTorrent CLI for seeding.** WebTorrent uses WebRTC, which standard torrent clients (qBittorrent, Transmission, etc.) cannot connect to. Use `mktorrent` + `transmission-daemon` instead.
- **Serve .torrent files, not just magnet links.** Magnet links require metadata download from a peer first — if peer discovery is slow, clients get stuck on "downloading metadata." .torrent files work immediately.
- **The local dev machine is behind CGNAT** (Centracom ISP) and cannot seed torrents. All seeding must happen from the VPS.
- **Info hashes differ between tools.** `mktorrent`, `create-torrent`, and `webtorrent` all produce different hashes from the same files. The only hash that matters is the one from the active seeder.
- The DB `Torrent` record must match the active VPS seeder hash (`bf69c35...`). The storefront now reads the magnet URI from the torrent API, not hardcoded mock data.

---

## Known Issues & Gotchas

1. **Port 3000 conflict** — `open-webui` Docker container uses port 3000. BoilerDeck API runs on 3001.
2. **BigInt serialization** — Prisma returns BigInt for large integer columns. The `toJSON` patch in `shared/src/db.ts` handles this, but if you see `TypeError: Do not know how to serialize a BigInt`, the server process may be stale (see #3).
3. **Stale server processes** — `pkill -f "tsx"` doesn't always kill the old process on Windows. Use `taskkill //F //PID <pid>` or check `netstat -ano | grep 3001` to find and kill the specific process.
4. **WebTorrent vs standard BitTorrent** — WebTorrent uses WebRTC (for browsers), standard clients use TCP/UDP. They cannot peer with each other. Always use standard tools (`mktorrent`, `transmission-daemon`) for seeding, not `webtorrent-cli`.
5. **Info hashes differ between tools** — `mktorrent`, `create-torrent`, and `webtorrent` all produce different hashes from the same files. Always use the hash from the actively running seeder.
6. **CGNAT** — Local dev machine is behind CGNAT (Centracom ISP, 10.100.79.x). Cannot accept incoming connections. All seeding must happen from the VPS.
7. **Express 5 params** — `req.params.*` returns `string | string[]`. All route handlers wrap params with `String()`.
8. **JWT expiresIn typing** — Newer `@types/jsonwebtoken` expects `StringValue`. Cast with `as unknown as jwt.SignOptions["expiresIn"]`.
9. **ioredis ESM import** — Use `const RedisClient = IORedis.default ?? IORedis;` for ESM compatibility.
10. **Zustand selector trap** — Never select a *function* from a Zustand store (e.g. `useStore(s => s.isOwned)`) and call it during render to derive display state. The function reference is stable, so the component won't re-render when the underlying data changes. Instead, select the *data* (e.g. `useStore(s => s.licenses)`) and compute inline. This bit us with ownership badges not updating after license fetch.
11. **Refresh token localStorage shared across SPAs** — Both web storefront and dev-portal use `pp_refresh_token` key in localStorage on the same origin. This is intentional SSO. Don't change the key in one without the other.
13. **Vite `base` must match nginx path** — If a frontend is served under a subpath (e.g. `/dev/`), Vite's `base` in `vite.config.ts` must match (e.g. `base: "/dev/"`), otherwise asset URLs resolve to `/assets/...` instead of `/dev/assets/...` and you get a blank page.
14. **nginx `default_server`** — The boilerdeck site config uses `listen 80 default_server;` to override nginx's built-in welcome page. Without this, requests may hit the default nginx page instead.
15. **Multer temp dir** — The upload route auto-creates `/opt/boilerdeck/games/.tmp/` via `fs.mkdirSync(tmpDir, { recursive: true })` in the multer destination callback. Don't rely on it pre-existing.
16. **Upload pipeline proxy timeout** — nginx default `proxy_read_timeout` is 60s. Large uploads may need `proxy_read_timeout 1800;` in the `/api/` block if server-side processing (zip extraction + torrent creation) takes longer than 60s after upload completes.
17. **VPS deploy — Rollup Linux binding** — `package-lock.json` generated on Windows won't include `@rollup/rollup-linux-x64-gnu`. After `npm install` on VPS, may need `npm install @rollup/rollup-linux-x64-gnu` explicitly, or do a clean `rm -rf node_modules && npm install` on the VPS.
18. **VPS deploy — Prisma client regeneration** — After wiping `node_modules` on VPS, must run `npx prisma generate` before starting the server, otherwise Prisma client will be missing.
19. **Stripe Connect onboard tokens** — The return/refresh URLs for Stripe Connect use Redis-backed one-time-use tokens (`crypto.randomBytes(32)`, stored as `stripe_onboard:{token}` with 1-hour TTL). Tokens are consumed on use (deleted from Redis). Never pass raw Stripe account IDs in query params.
20. **Stripe webhook idempotency** — All webhook handlers (`handleCheckoutCompleted`, `handleCheckoutExpired`, `handleAccountUpdated`) check current state before mutating. `handleCheckoutExpired` won't overwrite a COMPLETED payment. `handleCheckoutCompleted` won't create duplicate licenses.

---

## Git State

- **Repo:** https://github.com/EthanGeisler/peerplay (rename pending — GitHub repo still named `peerplay`)
- **Branch:** `main` (only branch)
- **17 commits** as of 2026-03-16 (latest first):
  1. `dfd977a` `Fix review issues: Stripe security, webhook idempotency, frontend cleanup` — Redis-backed onboard tokens, getStripe extraction to shared, orphaned payment cleanup, CheckoutSuccess rewrite, redirectToStripeOnboard helper, Stripe SDK alignment
  2. `3e6f71d` `Fix Stripe Connect return endpoint and Dashboard error logging`
  3. `cd78e5c` `Rebrand Peerplay to BoilerDeck and set up boilerdeck.com domain` — all package names @peerplay→@boilerdeck, UI text, HTML titles, server logs, torrent metadata, docs, VPS infra (/opt/boilerdeck, boilerdeck.service, nginx config, SSL cert)
  4. `5550a92` `Update CONTEXT.md and CLAUDE.md for storefront API integration`
  5. `148e5ec` `Fix review issues: logout token revocation, 204 handling, accessibility, dedup`
  6. `6f6caac` `Connect web storefront to real API, replacing all mock data`
  7. `695459d` `Update CONTEXT.md and CLAUDE.md with upload pipeline and VPS consolidation`
  8. `47a4b29` `Move web storefront to VPS and add Developer Portal link`
  9. `f1a267c` `Auto-create upload temp directory if missing`
  10. `7122663` `Require game build upload when creating a new game`
  11. `7164553` `Set base path for dev portal served under /dev/`
  12. `aee5333` `Add game file upload pipeline with automatic torrent creation`
  13. `b147608` `Deploy to Hetzner VPS with standard BitTorrent seeding`
  14. `bbc01e1` `Implement LIGHT and ENCRYPTED DRM tiers across server and storefront`
  15. `a1b1673` `Add CONTEXT.md for session continuity between Claude instances`
  16. `87ffa4f` `Update Player Character 01 magnet URI to match active WebTorrent seeder`
  17. `d01f51f` `Add Player Character 01 as first game on the platform`
  18. `f71401e` `Initial commit: Peerplay MVP`
- **Git identity:** `EthanGeisler` / `25466222+EthanGeisler@users.noreply.github.com`

---

## What's Next (Not Yet Built)

Refer to the plan in `.claude/plans/twinkling-hugging-thunder.md` for the full roadmap. Key next steps:

### Short-term
- [x] Connect web storefront to real API (replace mock data with fetch calls) — done 2026-03-16
- [x] Stripe Connect integration (real payments via Stripe Checkout + Connect destination charges) — done 2026-03-16
- [ ] Finish Electron client (WebTorrent download in hidden renderer, game launch, progress tracking)
- [x] DRM Tier 1 (LIGHT) — server: device fingerprinting in verifyLicense, max 3 devices, device deregistration endpoint
- [x] DRM Tier 2 (ENCRYPTED) — server: crypto utils (AES-256-GCM wrap/unwrap, HKDF derivation), key delivery endpoint, encryption metadata in torrent responses, encrypt-game + publish-game-encrypted scripts
- [x] DRM storefront UI — edition picker on PC01 (Free/Premium), DRM badges on game cards, DRM info card on detail page, 3-column comparison on About page
- [x] Developer portal SPA (`dev-portal/`) — manage games, file upload pipeline, version management
- [x] Consolidated hosting — storefront + dev portal + API all on VPS
- [ ] Real cover art / screenshots for Player Character 01 (currently using placehold.co)
- [ ] Electron client DRM integration (call verify endpoint at launch, call key endpoint for encrypted games)

### Medium-term
- [ ] Steam shortcuts.vdf integration (games appear in Steam library)
- [ ] Cloud save sync (Backblaze B2)
- [ ] Client auto-update (electron-updater)
- [ ] Search / categories / reviews
- [ ] Private opentracker instance + seed boxes

### Long-term
- [ ] Mac/Linux clients
- [ ] Bitcoin Lightning payments
- [ ] Developer analytics dashboard
- [ ] Delta updates / patching
- [ ] Refund system

---

## Stripe Connect Integration

**Architecture:** Stripe Connect with Express accounts + destination charges.

**Onboarding flow (developer):**
1. Developer clicks "Connect with Stripe" → `GET /api/developer/stripe/onboard`
2. Server creates Stripe Express account (if none), generates Account Link, stores Redis-backed onboard token
3. Developer completes Stripe onboarding → redirected to `GET /api/developer/stripe/return?token=...`
4. Return endpoint verifies token, checks `charges_enabled`/`payouts_enabled`, updates Developer record
5. If onboarding incomplete, refresh endpoint generates new Account Link with fresh token

**Checkout flow (player):**
1. Player clicks "Buy" on game detail page → `POST /api/payments/checkout`
2. **Free games:** Atomic `$transaction` creates Payment (COMPLETED) + License (ACTIVE) immediately
3. **Paid games:** Creates PENDING Payment → Stripe Checkout Session with `application_fee_amount` + `transfer_data.destination` → returns checkout URL
4. Player completes payment on Stripe → `checkout.session.completed` webhook fires
5. Webhook handler: updates Payment to COMPLETED, creates License (ACTIVE) — all in `$transaction`
6. If session expires: `checkout.session.expired` webhook sets Payment to FAILED (only if not already COMPLETED)

**Key files:**
- `server/packages/auth/src/developer.routes.ts` — onboard, return, refresh endpoints + Redis token functions
- `server/packages/payment/src/service.ts` — checkout, handleWebhook, handleCheckoutCompleted/Expired/AccountUpdated
- `server/packages/shared/src/stripe.ts` — `getStripe()` singleton (used by both auth and payment)
- `web/src/pages/CheckoutSuccess.tsx` — post-purchase polling page
- `dev-portal/src/api.ts` — `redirectToStripeOnboard()` shared helper

**Stripe SDK:** `stripe@^20.4.1` (aligned across shared, auth, payment packages)

---

## Quick Reference

| What | Where |
|------|-------|
| Storefront (live) | https://boilerdeck.com/ |
| Developer Portal (live) | https://boilerdeck.com/dev/ |
| Production API | https://boilerdeck.com/api/health |
| GitHub Pages (legacy) | https://ethangeisler.github.io/peerplay/ |
| Local API | http://localhost:3001/api/health |
| VPS SSH | `ssh root@204.168.133.38` |
| Prisma schema | `server/prisma/schema.prisma` |
| Server env (local) | `server/.env` |
| Server env (VPS) | `/opt/boilerdeck/server/.env` |
| Nginx config (VPS) | `/etc/nginx/sites-available/boilerdeck` |
| Storefront API client | `web/src/api.ts` |
| Storefront types | `web/src/types.ts` |
| Storefront shared utils | `web/src/utils.ts` |
| Stripe singleton | `server/packages/shared/src/stripe.ts` |
| Stripe onboard tokens | `server/packages/auth/src/developer.routes.ts` (`createOnboardToken`/`verifyOnboardToken`) |
| Stripe checkout + webhooks | `server/packages/payment/src/service.ts` |
| Deploy workflow (GH Pages) | `.github/workflows/deploy.yml` |
| Full architecture plan | `.claude/plans/twinkling-hugging-thunder.md` |
| Game build (PC01) | `C:\Users\eface\player-character-01\build\PeerPlayBuild\` |
| Game files (VPS) | `/opt/boilerdeck/games/<slug>/` |
| Upload temp (VPS) | `/opt/boilerdeck/games/.tmp/` |
| Torrent scripts | `scripts/` |
| Transmission config | `/root/.config/transmission-daemon/settings.json` (on VPS) |
| Dev portal login | `dev@example.com` / `developer123` |
| Storefront player login | `player@example.com` / `player123456` |
