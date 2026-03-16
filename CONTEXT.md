# Peerplay — Project Context

> Read this first every session. This file captures the current state of the project so future Claude instances can pick up where the last one left off.

---

## What Is Peerplay?

A **Steam competitor** that uses **BitTorrent for game file distribution** with a lightweight centralized backend for auth, payments, and metadata.

**Key value props:**
- **99/1 revenue split** (developer/platform) — made possible by zero CDN costs (BitTorrent)
- **Developer-choice DRM** — None, Light (online check), or Encrypted (AES-256-CTR)
- **Open-source client** (MIT), proprietary server
- Future: Steam library integration, cloud saves, Bitcoin Lightning payments

**Live URLs:**
- **Storefront:** http://204.168.133.38/ (VPS, served by nginx)
- **Developer Portal:** http://204.168.133.38/dev/ (VPS, served by nginx)
- **API:** http://204.168.133.38/api/health
- **GitHub Pages (legacy):** https://ethangeisler.github.io/peerplay/ — still auto-deploys but storefront is now served from VPS

---

## What Has Been Built (MVP v0.1)

### Server — Express + TypeScript monorepo (`server/`)

Fully functional REST API running on port **3001** (port 3000 is used by open-webui Docker container on this machine).

**Packages** (`server/packages/`):
| Package | What it does | Key files |
|---------|-------------|-----------|
| `shared` | Prisma client, middleware (auth, role check, error handler), config (Zod-validated env), Redis client, error classes | `src/db.ts`, `src/middleware.ts`, `src/config.ts`, `src/errors.ts`, `src/redis.ts` |
| `auth` | JWT auth (access 15m + refresh 7d with rotation), bcrypt password hashing, user registration/login | `src/service.ts`, `src/routes.ts`, `src/developer.routes.ts` |
| `catalog` | Game CRUD, slug generation, paginated listing, game detail, **file upload pipeline** (zip extraction, torrent creation, Transmission seeding, exe auto-detection) | `src/service.ts`, `src/routes.ts` |
| `license` | License listing, verification with device fingerprinting (max 3 devices), decryption key delivery for ENCRYPTED tier, device deregistration. Crypto utils for AES-256-GCM key wrap/unwrap and HKDF per-user key derivation. | `src/service.ts`, `src/routes.ts`, `src/crypto.ts` |
| `payment` | Mock checkout flow — atomic `$transaction` creates Payment + License together, 1% platform fee calc | `src/service.ts`, `src/routes.ts` |
| `torrent` | Torrent retrieval with license ownership check, **`createGameTorrent()` for generating .torrent files** (used by catalog upload pipeline) | `src/service.ts`, `src/routes.ts`, `src/vendor.d.ts` |
| `saves` | Cloud save upload/download — **scaffolded but not implemented** | `src/index.ts` |

**Database:** PostgreSQL 16 via Prisma ORM (`server/prisma/schema.prisma`)
- 10 models: User, RefreshToken, Developer, Game, GameVersion, Torrent, EncryptionKey, License, Payment, SaveFile
- 6 enums: UserRole, GameStatus, VersionStatus, DrmTier, LicenseStatus, PaymentStatus
- All models use `@@map("snake_case")` for DB table names, PascalCase in code
- BigInt columns (fileSizeBytes, sizeBytes) need `BigInt.prototype.toJSON` patch (in `shared/src/db.ts`)

**Seed data** (`server/prisma/seed.ts`):
- Admin: `admin@peerplay.io` / `admin123456`
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
- `POST /api/developer/register`, `GET /api/developer/stripe/onboard`, `GET /api/developer/me`
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

**Deployment:** Served from VPS via nginx (`/opt/peerplay/web/dist`). GitHub Actions still deploys to Pages (`.github/workflows/deploy.yml`) but that's now legacy.

**Vite config:** `base: "/"`, dev proxy: `/api` → `http://localhost:3001` (for local development).

### Developer Portal — Vite + React 19 (`dev-portal/`)

SPA served from VPS at `/dev/`. Talks to the real API. Login with developer credentials.

**Pages** (`dev-portal/src/pages/`):
- `Login.tsx` — Email/password login
- `SetupDeveloper.tsx` — First-time developer profile creation
- `Dashboard.tsx` — Lists developer's games with version/license counts
- `GameDetail.tsx` — Full game management: publish/unpublish, version list with torrent info, **file upload** (drag-and-drop zip → progress bar → processing → READY)
- `GameEditor.tsx` — Create/edit game form. **Creating a game requires uploading a zip** (version + zip fields). Exe auto-detected from upload.

**Upload flow (end-to-end):**
1. Frontend: `POST /developer/games` → creates game
2. Frontend: `POST /developer/games/:id/versions` → creates version (PROCESSING status)
3. Frontend: `POST /developer/games/:id/versions/:versionId/upload` → uploads zip via `apiUpload()` (XHR with progress)
4. Server (catalog service `uploadAndProcessVersion`): extracts zip → calculates size → auto-detects exe → calls `createGameTorrent()` → creates Torrent DB record → updates version to READY → adds torrent to Transmission via RPC → cleans up temp zip
5. Transmission RPC (`addToTransmission`): POST to `http://127.0.0.1:9091/transmission/rpc`, handles 409 CSRF dance, base64 metainfo, non-blocking (failure logged but doesn't block upload)

**Key files:**
- `dev-portal/src/api.ts` — `apiFetch()` (fetch + auth refresh) + `apiUpload()` (XHR with progress callback)
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

### Production VPS (Hetzner CX23) — `204.168.133.38`

The production environment runs on a Hetzner VPS. All services auto-start on boot.

| Service | Details |
|---------|---------|
| **Nginx** | Port 80 (`default_server`). `/` → `web/dist`, `/dev/` → `dev-portal/dist`, `/api/` → proxy to Node 3001. `client_max_body_size 2g` on `/api/`. |
| **Peerplay API** | systemd service `peerplay`, Node/tsx on port 3001 |
| **PostgreSQL 16** | User: `peerplay`, DB: `peerplay`, localhost:5432 |
| **Redis 7** | localhost:6379 |
| **Transmission** | BitTorrent seeder on port 6881. RPC at `http://127.0.0.1:9091/transmission/rpc`. Upload pipeline auto-adds torrents via RPC. |

**SSH access:** `ssh root@204.168.133.38` (key: `~/.ssh/id_ed25519` on dev machine)

**Project location on VPS:** `/opt/peerplay/`
**Game files on VPS:** `/opt/peerplay/games/<game-slug>/` (created automatically by upload pipeline)
**Upload temp dir:** `/opt/peerplay/games/.tmp/` (auto-created by multer on first upload)
**Torrent file on VPS:** Stored in DB as `Torrent.torrentFile` (Bytes column), no longer loose files
**Nginx config:** `/etc/nginx/sites-available/peerplay`
**VPS .env:** `/opt/peerplay/server/.env` (includes `TRANSMISSION_RPC_URL`)

**VPS management commands:**
```bash
# Check API
curl http://204.168.133.38/api/health

# Check seeder status
ssh root@204.168.133.38 "transmission-remote -l"

# Check seeder peers/trackers
ssh root@204.168.133.38 "transmission-remote -t 1 -it"

# Restart API
ssh root@204.168.133.38 "systemctl restart peerplay"

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

**Environment:** `server/.env` — contains DATABASE_URL, REDIS_URL, JWT secrets, Stripe keys (mock), port config, optional `DRM_MASTER_KEK` (64+ hex chars, required for ENCRYPTED DRM tier). Not committed to git. Separate `.env` exists on VPS at `/opt/peerplay/server/.env`.

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

1. **Port 3000 conflict** — `open-webui` Docker container uses port 3000. Peerplay API runs on 3001.
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
14. **nginx `default_server`** — The peerplay site config uses `listen 80 default_server;` to override nginx's built-in welcome page. Without this, requests may hit the default nginx page instead.
15. **Multer temp dir** — The upload route auto-creates `/opt/peerplay/games/.tmp/` via `fs.mkdirSync(tmpDir, { recursive: true })` in the multer destination callback. Don't rely on it pre-existing.
16. **Upload pipeline proxy timeout** — nginx default `proxy_read_timeout` is 60s. Large uploads may need `proxy_read_timeout 1800;` in the `/api/` block if server-side processing (zip extraction + torrent creation) takes longer than 60s after upload completes.

---

## Git State

- **Repo:** https://github.com/EthanGeisler/peerplay
- **Branch:** `main` (only branch)
- **12 commits** as of 2026-03-16:
  1. `Initial commit: Peerplay MVP` — full monorepo with server, client, web, scripts
  2. `Add Player Character 01 as first game on the platform` — mock data, publish script, torrent file
  3. `Update Player Character 01 magnet URI to match active WebTorrent seeder` — fixed info hash mismatch
  4. `Add CONTEXT.md for session continuity between Claude instances`
  5. `Implement LIGHT and ENCRYPTED DRM tiers across server and storefront` — device fingerprinting, key delivery, crypto utils, edition picker, DRM badges, About page overhaul, encryption scripts
  6. `Deploy to Hetzner VPS with Transmission seeder` — VPS setup, standard BitTorrent seeding, CONTEXT.md updates
  7. `Add game file upload pipeline with automatic torrent creation` — dev portal, upload route, multer, unzipper, Transmission RPC, XHR progress, drag-and-drop UI
  8. `Set base path for dev portal served under /dev/` — Vite `base: "/dev/"` fix
  9. `Require game build upload when creating a new game` — zip + version required on game creation
  10. `Move web storefront to VPS and add Developer Portal link` — `base: "/"`, nginx serves web at `/`, dev portal link in header
  11. `Connect web storefront to real API, replacing all mock data` — deleted mock.ts + appStore.ts, added api.ts, types.ts, authStore, gameStore, libraryStore, Login page, rewrote Store/GameDetail/Library/App to use real API
  12. `Fix review issues: logout token revocation, 204 handling, accessibility, dedup` — send refresh token on logout, handle 204 in apiFetch, extract shared utils.ts, htmlFor/id on labels, keyboard-accessible cards, individual Zustand selectors
- **Git identity:** `EthanGeisler` / `25466222+EthanGeisler@users.noreply.github.com`

---

## What's Next (Not Yet Built)

Refer to the plan in `.claude/plans/twinkling-hugging-thunder.md` for the full roadmap. Key next steps:

### Short-term
- [x] Connect web storefront to real API (replace mock data with fetch calls) — done 2026-03-16
- [ ] Stripe Connect integration (real payments, currently mocked)
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

## Quick Reference

| What | Where |
|------|-------|
| Storefront (live) | http://204.168.133.38/ |
| Developer Portal (live) | http://204.168.133.38/dev/ |
| Production API | http://204.168.133.38/api/health |
| GitHub Pages (legacy) | https://ethangeisler.github.io/peerplay/ |
| Local API | http://localhost:3001/api/health |
| VPS SSH | `ssh root@204.168.133.38` |
| Prisma schema | `server/prisma/schema.prisma` |
| Server env (local) | `server/.env` |
| Server env (VPS) | `/opt/peerplay/server/.env` |
| Nginx config (VPS) | `/etc/nginx/sites-available/peerplay` |
| Storefront API client | `web/src/api.ts` |
| Storefront types | `web/src/types.ts` |
| Storefront shared utils | `web/src/utils.ts` |
| Deploy workflow (GH Pages) | `.github/workflows/deploy.yml` |
| Full architecture plan | `.claude/plans/twinkling-hugging-thunder.md` |
| Game build (PC01) | `C:\Users\eface\player-character-01\build\PeerPlayBuild\` |
| Game files (VPS) | `/opt/peerplay/games/<slug>/` |
| Upload temp (VPS) | `/opt/peerplay/games/.tmp/` |
| Torrent scripts | `scripts/` |
| Transmission config | `/root/.config/transmission-daemon/settings.json` (on VPS) |
| Dev portal login | `dev@example.com` / `developer123` |
| Storefront player login | `player@example.com` / `player123456` |
