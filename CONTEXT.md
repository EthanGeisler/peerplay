# BoilerDeck — Project Context

> Read this first every session. This file captures the current state of the project so future Claude instances can pick up where the last one left off.

---

## What Is BoilerDeck?

A **multi-content marketplace** (games, videos, software, audio) that uses **BitTorrent for file distribution** with a lightweight centralized backend for auth, payments, and metadata.

**Key value props:**
- **99/1 revenue split** (developer/platform) — made possible by zero CDN costs (BitTorrent)
- **DRM-free distribution** — developers handle their own copy protection before uploading (see "Copy Protection Philosophy" below)
- **Open-source client** (MIT), proprietary server
- Future: Steam library integration, cloud saves, Bitcoin Lightning payments

**Live URLs:**
- **Storefront:** https://boilerdeck.com/ (VPS, nginx + Let's Encrypt SSL)
- **Developer Portal:** https://boilerdeck.com/dev/
- **API:** https://boilerdeck.com/api/health
- **GitHub Pages (legacy):** https://ethangeisler.github.io/peerplay/ — still auto-deploys but storefront is now served from VPS

---

## Copy Protection Philosophy

BoilerDeck is a **distribution platform, not a DRM provider**. Game builds are distributed as-is via BitTorrent. The platform does not encrypt, wrap, or modify game files in any way.

**Why:** Building and maintaining effective DRM requires ongoing dedicated effort (cat-and-mouse with crackers). Platform-side DRM that lives outside the game binary (in a launcher wrapper) is fundamentally a checkbox — the actual game files are unprotected on disk. Engine-native protection (Godot PCK encryption, Unity IL2CPP, Unreal Pak encryption, tools like Themida/VMProtect) is stronger because it's integrated into the game itself.

**What the platform provides:**
- License records (who bought what) — needed for payments and library display
- Purchase flow (Stripe checkout, license grants)
- BitTorrent distribution

**What developers do themselves (if they want protection):**
- Apply copy protection before uploading using their engine's built-in tools
- Both the dev-portal GameEditor and Electron client DevGameEditor show a "Copy Protection" guidance box with engine-specific tips

**History:** BoilerDeck previously had a three-tier DRM system (NONE, LIGHT online-check, ENCRYPTED AES-256-CTR). This was fully removed on 2026-03-17 (migration `remove_drm_system`). The decision was made because: (1) LIGHT DRM only checked at launch via the client wrapper — game files were unprotected on disk and trivially copyable, (2) ENCRYPTED DRM decrypted files to plaintext on first launch — same result, (3) maintaining DRM requires ongoing effort incompatible with a hands-off platform, (4) developers using engine-native tools get better protection with zero platform maintenance.

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
| `license` | License listing only — `listUserLicenses()` returns owned games for library display. Single endpoint: `GET /licenses`. | `src/service.ts`, `src/routes.ts` |
| `payment` | **Real Stripe Checkout** — free games: atomic license grant; paid games: Stripe Checkout Session with Connect destination charges, platform fee (1%), webhook handlers for `checkout.session.completed`/`expired`/`account.updated`, idempotent payment+license creation, orphaned payment cleanup on Stripe failure | `src/service.ts`, `src/routes.ts` |
| `torrent` | Torrent retrieval with license ownership check, **`createGameTorrent()` for generating .torrent files** (used by catalog upload pipeline), **`getLatestTorrentFile()` for raw .torrent bytes** (used by Electron client) | `src/service.ts`, `src/routes.ts`, `src/vendor.d.ts` |
| `saves` | Cloud save upload/download — **scaffolded but not implemented** | `src/index.ts` |
| `locker` | Data Locker — personal encrypted file storage (upload, list, delete, share, torrent, dedup, seed management, health) | `src/service.ts`, `src/routes.ts`, `src/storage.ts`, `src/dedup.ts`, `src/seedManager.ts` |

**Database:** PostgreSQL 16 via Prisma ORM (`server/prisma/schema.prisma`)
- 8 models: User, RefreshToken, Developer, Listing (@@map "games"), ListingVersion (@@map "game_versions"), Torrent, License, Payment, SaveFile
- 5 enums: UserRole, ListingStatus (@@map "GameStatus"), VersionStatus, LicenseStatus, PaymentStatus, ContentType (GAME, VIDEO, SOFTWARE, AUDIO, OTHER)
- All models use `@@map("snake_case")` for DB table names, PascalCase in code
- BigInt columns (fileSizeBytes, sizeBytes) need `BigInt.prototype.toJSON` patch (in `shared/src/db.ts`)

**Seed data** (`server/prisma/seed.ts`):
- Admin: `admin@boilerdeck.com` / `admin123456`
- Developer: `dev@example.com` / `developer123` (studio: "Indie Games Studio")
- Player: `player@example.com` / `player123456`
- 3 sample games (Space Explorer $19.99, Dungeon Crawl $9.99, Pixel Racing Free)
- Player Character 01 — Premium Edition ($9.99)

> **DB is currently wiped** (as of 2026-03-17) — all seed data removed, no users, games, or licenses. Real data uploaded through dev portal. Do not run `npm run db:seed` against VPS without confirming it's intentional.

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
- `GET /api/licenses` (returns `{ licenses: [...] }` — ownership list for library)
- `POST /api/payments/checkout`, `POST /api/payments/webhook`
- `GET /api/torrents/:gameId/latest` (torrent metadata: gameId, versionId, version, fileSizeBytes, magnetUri, infoHash)
- `GET /api/torrents/:gameId/latest/file` (raw `.torrent` bytes, `application/x-bittorrent`, authenticated + license check)
- `PUT /api/profiles/me`, `GET /api/profiles/:pubkey`
- `POST /api/games/:slug/reviews`, `GET /api/games/:slug/reviews`
- `POST /api/follows`, `GET /api/follows/:pubkey`, `DELETE /api/follows/:pubkey`
- `POST /api/events/:eventId/replies`, `GET /api/events/:eventId/replies`
- `POST /api/moderation/mute`, `DELETE /api/moderation/mute/:pubkey`, `POST /api/moderation/delete`
- `GET /api/reputation/:pubkey`
- `GET /api/events?kinds=1&limit=30&until=<unix_ts>&authors=<csv>` (feed queries, supports pagination via `until`)
- `POST /api/events/sign-and-publish` (server signs with user's cached key, stores, broadcasts to WS relay + federates)
- `GET /api/health`

### Web Storefront — Vite + React 19 (`web/`)

SPA served from VPS at `/`. Uses **HashRouter**. Talks to the **real API** (not mock data). Also still deploys to GitHub Pages via Actions but the primary URL is now the VPS. Header includes a "Developer Portal" link to `/dev/`.

**Pages** (`web/src/pages/`):
- `Store.tsx` — Featured hero (first game in DB) + game grid cards. Fetches real games from `GET /api/games`. Search with debounce.
- `GameDetail.tsx` — Full detail page with purchase button (real checkout via `POST /api/payments/checkout`), torrent download link after purchase (via `GET /api/torrents/:gameId/latest`), revenue split breakdown, version info
- `Library.tsx` — Owned games from real licenses (`GET /api/licenses`). Links to `/login` for unauthenticated users.
- `Login.tsx` — Login/Register form with tabs. JWT auth via `POST /api/auth/login|register`.
- `About.tsx` — Platform explainer (revenue split, BitTorrent distribution model, tech stack)
- `Social.tsx` — Twitter-like news feed with For You / Following sub-tabs, post composer, paginated via `GET /api/events?kinds=1`. Profile resolution via `GET /api/profiles/:pubkey`.
- `Profile.tsx` — User profile page at `/profile/:pubkey`. Display name, bio, avatar, follow/unfollow, reputation badge.
- `CheckoutSuccess.tsx` — Post-purchase page. Polls `fetchLicenses()` until new license appears (webhook latency). Handles unauthenticated users with sign-in prompt.
- `CheckoutCancel.tsx` — Shown when user cancels Stripe Checkout. Links back to store.

**State:** Three Zustand stores (split by concern):
- `web/src/stores/authStore.ts` — Login, register, logout, session restore via refresh token. On mount, `loadSession()` tries to restore session from `pp_refresh_token` in localStorage.
- `web/src/stores/gameStore.ts` — `fetchGames()` (listing) and `fetchGameBySlug()` (detail page)
- `web/src/stores/libraryStore.ts` — `fetchLicenses()`, `checkout()`, `fetchTorrent()`. No `isOwned` function — components select the `licenses` array directly and compute ownership inline (see Zustand gotcha below).

**API client:** `web/src/api.ts` — `apiFetch()` with JWT auto-refresh on 401, `ApiError` class, 204 handling. Copied from dev-portal's `api.ts` (minus `apiUpload()`). `refreshAccessToken()` is exported and reused by authStore's `loadSession`.

**Types:** `web/src/types.ts` — TypeScript interfaces matching actual server response shapes: `ApiGame`, `ApiGameDetail`, `ApiUser`, `ApiAuthResponse`, `ApiLicense`, `ApiTorrent`, `ApiCheckoutResult`, `ApiGameListResponse`, `ApiReview`, `ApiReviewsResponse`, `NostrEvent`, `ProfileData`.

**Shared components** (`web/src/components/`):
- `PostCard.tsx` — Feed item card: avatar + author name (links to profile) + relative timestamp + content. Props: `event`, `authorName?`, `authorPicture?`.
- `ComposeBox.tsx` — Post composer: textarea + Post button. Submits via `POST /api/events/sign-and-publish` with `{ kind: 1, content, tags: [] }`. Calls `onPost(event)` callback on success.
- `ReviewSection.tsx` — Review list with stars, pagination
- `ReviewForm.tsx` — Star selector, title, body, submit (requires login + ownership)

**Shared utils:** `web/src/utils.ts` — `formatPrice()`, `formatSize()`, `PLACEHOLDER_COVER` constant. Used by Store, GameDetail, Library.

**Key differences from mock era:**
- No more `editions` concept (DB has single `priceCents` per game, no edition picker)
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
- `GameEditor.tsx` — Create/edit game form with copy protection guidance info box. **Creating a game requires uploading a zip** (version + zip fields). Exe auto-detected from upload.

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

### Electron Client — functional (`client/`)

Full desktop client: browse store, purchase games (Stripe Checkout in system browser), download via BitTorrent, game launch, install management.

**Architecture — critical decisions:**
- **WebTorrent runs in the Node.js main process** (NOT a hidden renderer). This enables TCP/UDP peering with the Transmission seeder on the VPS. A hidden renderer would only support WebRTC, which Transmission can't connect to.
- **HashRouter** (not BrowserRouter) — required because Electron loads `file://` URLs in production, which don't support `pushState`.
- **`contextIsolation: true`, `nodeIntegration: false`** — all renderer↔main communication goes through the preload bridge (`window.boilerdeck`).
- **IPC pattern:** `ipcRenderer.invoke()` for request/response, `ipcRenderer.on()` for push events (download progress, download completion).
- **API base:** `https://boilerdeck.com/api` (hardcoded in `client/src/renderer/api.ts`). No local proxy — the client talks directly to the production API.

**Main process (`client/src/main/`):**
| File | Purpose |
|------|---------|
| `index.ts` | Electron app lifecycle, all IPC handler registration, torrent client init/destroy, auto-updater setup (check/download/progress/error events forwarded to renderer) |
| `preload.ts` | `contextBridge.exposeInMainWorld("boilerdeck", {...})` — sections: platform, updater, store, crypto, events, relay, privacy, tor, api, shell, dialog, games, downloads, locker, listings |
| `store.ts` | JSON file persistence at `app.getPath("userData")/boilerdeck-config.json`. Keys: refreshToken, installDir, installedGames, settings |
| `torrentManager.ts` | WebTorrent singleton. `startDownload()` prefers .torrent buffer over magnet. Broadcasts progress every 1s via `mainWindow.webContents.send("downloads:progress-update")`. Sends `downloads:complete` with gameId/title/infoHash/downloadPath on torrent done. |
| `gameLauncher.ts` | `child_process.spawn(exe, [], { detached: true, stdio: "ignore" })` + `child.unref()`. Tracks running games in a Map. `uninstallGame()` uses `fs.promises.rm(path, { recursive: true, force: true })`. |
| `vendor.d.ts` | Type declarations for `webtorrent` module |

**Renderer (`client/src/renderer/`):**
| File | Purpose |
|------|---------|
| `api.ts` | `apiFetch()` with JWT auto-refresh on 401. Refresh token read/written via `window.boilerdeck.store` IPC (not localStorage). |
| `types.ts` | All API types + client types (InstalledGame, DownloadProgress) |
| `utils.ts` | `formatPrice()`, `formatSize()`, `PLACEHOLDER_COVER` |
| `env.d.ts` | `/// <reference types="vite/client" />` + full `window.boilerdeck` type declarations |
| `main.tsx` | HashRouter, routes: `/`, `/game/:slug`, `/library`, `/downloads`, `/settings`, `/login` |

**Renderer stores (Zustand, `client/src/renderer/stores/`):**
| Store | Key functions |
|-------|-------------|
| `authStore.ts` | `loadSession()` (refresh token → user), login, register, logout. Persistent tokens via IPC store. |
| `gameStore.ts` | `fetchGames(page?)`, `fetchGameBySlug(slug)`, `clearCurrentGame()` |
| `libraryStore.ts` | `fetchLicenses()`, `checkout(gameId)`, `fetchTorrent(gameId)` |
| `downloadStore.ts` | `startDownload()`, pause/resume/cancel. `initListeners()` subscribes to progress + completion events. Module-level `downloadMeta` Map stores game metadata keyed by gameId. |
| `installedStore.ts` | `loadInstalled()` (from persistent store), `markInstalled(game)`, `uninstall(gameId)`, `launch(gameId)` — launches exe directly, no verification. |

**Download → Install pipeline (the most complex flow):**
1. User clicks Download → `downloadStore.startDownload()` stores metadata in `downloadMeta` Map, calls IPC `downloads:start`
2. Main process adds torrent to WebTorrent, begins downloading
3. Main process pushes `downloads:progress-update` every 1s → renderer updates progress bars
4. Torrent completes → main sends `downloads:complete` IPC event
5. `downloadStore` completion listener fires → calls `installedStore.markInstalled()` with full metadata → persisted to JSON store
6. Game appears in Library with Launch button

**Stripe checkout in client:**
- Free games: `checkout()` returns immediately, `fetchLicenses()` called inline
- Paid games: Opens Stripe Checkout URL in system browser via `shell.openExternal()`, then polls `fetchLicenses()` every 3s for up to 5 minutes

**Build config:**
- `electron-builder` in `client/package.json` — Windows: NSIS + portable; Linux: AppImage + deb. `asarUnpack` for `webtorrent`/`utp-native` (native deps)
- `vite.config.ts` has `base: "./"` for `file://` protocol
- `tsconfig.main.json` has `composite: true` (required because it's referenced by root tsconfig)

### Scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `upload-games.mjs` | **Primary upload tool.** Reads `game-staging/manifest.json`, creates game + version + uploads zip + uploads cover + publishes. Usage: `node scripts/upload-games.mjs <email> <password> [manifest.json]` |
| `upload-covers.mjs` | Uploads cover images for existing games. Matches by title substring. Usage: `node scripts/upload-covers.mjs <email> <password>` |
| `publish-all-drafts.mjs` | Publishes all DRAFT games. Usage: `node scripts/publish-all-drafts.mjs <email> <password>` |
| `reseed-torrents.sh` | Re-adds all published game torrents to Transmission on VPS. Usage: `ssh root@204.168.133.38 'bash -s' < scripts/reseed-torrents.sh` |
| `create-game-torrent.mjs` | Creates .torrent file from a game directory |
| `parse-torrent.mjs` | Parses .torrent to extract info hash + magnet URI |
| `publish-game.mjs` | Publishes a game in the DB (sets PUBLISHED, creates Torrent + GameVersion records) |
| `player-character-01.torrent` | Generated torrent file for PC01 (8KB) |
| `player-character-01.magnet.txt` | Magnet URI for quick reference |

**Game staging directory** (`game-staging/`): Gitignored. Contains downloaded game zips, cover images (`covers/`), and `manifest.json` for the upload script. See CLAUDE.md "Adding Games to the Platform" for the full workflow.

---

## Infrastructure

### Production VPS (Hetzner CX23) — `boilerdeck.com` (`204.168.133.38`)

The production environment runs on a Hetzner VPS. All services auto-start on boot. HTTPS via Let's Encrypt (auto-renews, cert at `/etc/letsencrypt/live/boilerdeck.com/`).

| Service | Details |
|---------|---------|
| **Nginx** | Ports 80 (→301 HTTPS) + 443 (SSL). `/` → `web/dist`, `/dev/` → `dev-portal/dist`, `/api/` → proxy to Node 3001. `/downloads/` → `/opt/boilerdeck/downloads/` (with `Content-Disposition: attachment`). `client_max_body_size 2g` on `/api/`. |
| **BoilerDeck API** | systemd service `boilerdeck`, Node/tsx on port 3001 |
| **PostgreSQL 16** | User: `peerplay`, DB: `peerplay`, localhost:5432 |
| **Redis 7** | localhost:6379 |
| **Transmission** | BitTorrent seeder on port 6881. RPC at `http://127.0.0.1:9091/transmission/rpc`. Upload pipeline auto-adds torrents via RPC. |

**SSH access:** `ssh root@204.168.133.38` (key: `~/.ssh/id_ed25519` on dev machine)

**Project location on VPS:** `/opt/boilerdeck/`
**Game files on VPS:** `/opt/boilerdeck/games/<game-slug>/` (created automatically by upload pipeline)
**Upload temp dir:** `/opt/boilerdeck/games/.tmp/` (auto-created by multer on first upload)
**Downloads dir:** `/opt/boilerdeck/downloads/` — contains `BoilerDeck Setup 0.2.1.exe` (~90MB installer, served at `/downloads/`)
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

**Re-seed all torrents after Transmission restart:**
```bash
# On VPS: extract all torrents from DB and add to Transmission
ssh root@204.168.133.38 'bash -s' << 'RESEED'
CSRF=$(curl -s -o /dev/null -D - http://127.0.0.1:9091/transmission/rpc 2>&1 | grep -oP "X-Transmission-Session-Id: \K.*" | tr -d "\r\n")
sudo -u postgres psql -d peerplay -t -A -c "SELECT id, encode(torrent_file, 'base64') FROM torrents;" | while IFS='|' read -r tid b64; do
  [ -z "$b64" ] && continue
  echo "Adding torrent $tid..."
  curl -s -X POST http://127.0.0.1:9091/transmission/rpc \
    -H "X-Transmission-Session-Id: $CSRF" \
    -d "{\"method\":\"torrent-add\",\"arguments\":{\"metainfo\":\"$b64\",\"download-dir\":\"/opt/boilerdeck/games\"}}"
  echo
done
transmission-remote -l
RESEED
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

**Environment:** `server/.env` — contains DATABASE_URL, REDIS_URL, JWT secrets, Stripe keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PLATFORM_FEE_PERCENT`), `CORS_ORIGIN`, `CORS_ADDITIONAL_ORIGINS` (comma-separated extra origins, e.g. for Electron dev), port config. Not committed to git. Separate `.env` exists on VPS at `/opt/boilerdeck/server/.env`.

**VPS `.env` note:** `CORS_ADDITIONAL_ORIGINS="http://localhost:5173"` is set on the VPS to allow Electron dev mode (renderer runs on localhost:5173 in dev, not `file://`).

---

## Games on the Platform

**8 published games** as of 2026-03-18. All seeded from VPS Transmission daemon on `204.168.133.38:6881`. All games are distributed DRM-free. 6 DRAFT duplicates cleaned up 2026-03-18.

### Original Games

#### PlayerCharacter01 (Web Build) — legacy, not launchable
- **DB slug:** `playercharacter01-fb92`
- **Info hash:** `9d8949a375b3cede3495e4e56622cb5bc75d791d`
- **Price:** $1.00
- **Issue:** This is a Godot web export (index.html + index.wasm). No exe — cannot be launched from the Electron client. Uploaded before we identified the web vs desktop build distinction.

#### PlayerCharacter01 Windows — the working game
- **DB slug:** `playercharacter01-windows-d919`
- **Info hash:** `cf3e503bb6e88f4fcdf2572629173884ec4c4994`
- **Exe path:** `PeerPlayBuild/PLAYER_CHARACTER_01PeerPlay.exe` (set in DB)
- **Size:** ~101MB (3 files: exe, console exe, pck)
- **Price:** $1.00
- **Source:** `C:\Users\eface\player-character-01\build\PeerPlayBuild\`
- **End-to-end verified:** Upload via dev portal → purchase → BitTorrent download → launch ✓ (2026-03-17)

### Open-Source Game Library (added 2026-03-17)

6 free, open-source games uploaded via `scripts/upload-games.mjs` to showcase the platform. All are GPL/zlib licensed and legally redistributable. Uploaded from portable Windows zip builds in `game-staging/`.

| Game | Slug | Info Hash | Size | Genre | License |
|------|------|-----------|------|-------|---------|
| OpenTTD | `openttd-dec4` | `4c9d465e...` | 33 MB | Transport Sim | GPLv2 |
| OpenRA | `openra-44be` | `dce6cd2c...` | 141 MB | RTS (C&C remake) | GPLv3 |
| Endless Sky | `endless-sky-45de` | `42528da9...` | 418 MB | Space Trading | GPLv3 |
| Warzone 2100 | `warzone-2100-ffc0` | `8ba93c4a...` | 432 MB | Sci-fi RTS | GPLv2+ |
| Veloren | `veloren-6d44` | `cfcdd8ad...` | 999 MB | Voxel RPG | GPLv3 |
| SuperTuxKart | `supertuxkart-4728` | `739de815...` | 1.59 GB | Kart Racing | GPLv3 |

All have cover images uploaded. All are free ($0).

> **Note:** 6 DRAFT duplicates from an accidental double-run were cleaned up on 2026-03-18 (deleted versions, torrents, and game rows).

### Accounts on VPS (DB wiped 2026-03-17, only real accounts exist)
- **Developer:** `eface` — uploaded all games via dev portal and scripts
- **Player:** `developer1` — purchased and downloaded PlayerCharacter01 Windows
- **Test reviewers (Phase 4):** `reviewer1@test.com`, `reviewer2@test.com`, `reviewer3@test.com` (password: `testpass123`) — created for review testing, have reviews on OpenTTD

**Important torrent lessons:**
- **Do NOT use WebTorrent CLI for seeding.** WebTorrent uses WebRTC, which standard torrent clients (qBittorrent, Transmission, etc.) cannot connect to. Use `mktorrent` + `transmission-daemon` instead.
- **Serve .torrent files, not just magnet links.** Magnet links require metadata download from a peer first — if peer discovery is slow, clients get stuck on "downloading metadata." .torrent files work immediately. The Electron client now fetches `.torrent` bytes from `/api/torrents/:gameId/latest/file` and falls back to magnet URI.
- **The local dev machine is behind CGNAT** (Centracom ISP) and cannot seed torrents. All seeding must happen from the VPS.
- **Info hashes differ between tools.** `mktorrent`, `create-torrent`, and `webtorrent` all produce different hashes from the same files. The only hash that matters is the one from the active seeder.
- **Upload pipeline creates torrent + adds to Transmission** — but the `addToTransmission()` call is fire-and-forget and **silently fails for large torrent files** (base64-encoded torrent data can exceed bash/curl argument limits). After uploading games, always re-seed: `ssh root@204.168.133.38 'bash -s' < scripts/reseed-torrents.sh`

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
12. **Vite `base` must match nginx path** — If a frontend is served under a subpath (e.g. `/dev/`), Vite's `base` in `vite.config.ts` must match (e.g. `base: "/dev/"`), otherwise asset URLs resolve to `/assets/...` instead of `/dev/assets/...` and you get a blank page.
13. **nginx `default_server`** — The boilerdeck site config uses `listen 80 default_server;` to override nginx's built-in welcome page. Without this, requests may hit the default nginx page instead.
14. **Multer temp dir** — The upload route auto-creates `/opt/boilerdeck/games/.tmp/` via `fs.mkdirSync(tmpDir, { recursive: true })` in the multer destination callback. Don't rely on it pre-existing.
15. **Upload pipeline proxy timeout** — nginx default `proxy_read_timeout` is 60s. Large uploads may need `proxy_read_timeout 1800;` in the `/api/` block if server-side processing (zip extraction + torrent creation) takes longer than 60s after upload completes.
16. **VPS deploy — Rollup Linux binding** — `package-lock.json` generated on Windows won't include `@rollup/rollup-linux-x64-gnu`. After `npm install` on VPS, may need `npm install @rollup/rollup-linux-x64-gnu` explicitly, or do a clean `rm -rf node_modules && npm install` on the VPS.
17. **VPS deploy — Prisma client regeneration** — After wiping `node_modules` on VPS, must run `npx prisma generate` before starting the server, otherwise Prisma client will be missing.
18. **Stripe Connect onboard tokens** — The return/refresh URLs for Stripe Connect use Redis-backed one-time-use tokens (`crypto.randomBytes(32)`, stored as `stripe_onboard:{token}` with 1-hour TTL). Tokens are consumed on use (deleted from Redis). Never pass raw Stripe account IDs in query params.
19. **Stripe webhook idempotency** — All webhook handlers (`handleCheckoutCompleted`, `handleCheckoutExpired`, `handleAccountUpdated`) check current state before mutating. `handleCheckoutExpired` won't overwrite a COMPLETED payment. `handleCheckoutCompleted` won't create duplicate licenses.
20. **CORS `origin: "null"` from Electron** — Electron `file://` sends `Origin: null` as a literal string, not absent. The CORS callback in `server/src/index.ts` handles three cases: `!origin` (no header, e.g. curl), `origin === "null"` (Electron file://), and origins in the allow list. Rejected origins get `callback(null, false)` (silent rejection, no 500).
21. **WebTorrent must run in main process** — If you put WebTorrent in a hidden BrowserWindow (renderer), it can only use WebRTC — standard BitTorrent clients (Transmission, qBittorrent) can't connect. The main process uses Node.js TCP/UDP sockets, enabling real BitTorrent peering. This is the single most important Electron architecture decision.
22. **Download completion requires IPC event** — The renderer has no way to know when a torrent finishes unless the main process explicitly sends a `downloads:complete` event. Without this, `markInstalled()` never fires and games don't appear in the Library after downloading. The event carries `{ gameId, title, infoHash, downloadPath }`.
23. **`downloadMeta` Map is module-level, not in Zustand** — The metadata needed to register an installed game (slug, exePath, version, coverImageUrl) is stored in a plain `Map<string, DownloadMeta>` outside the Zustand store in `downloadStore.ts`. This is intentional — it doesn't need to be reactive, and putting it in Zustand would cause unnecessary re-renders.
24. **`tsconfig.main.json` needs `composite: true`** — Because `tsconfig.json` references it. Without this, you get `TS6306: Referenced project must have setting "composite": true`.
25. **Electron client renderer types** — `window.boilerdeck` types are declared in two places: `client/src/main/preload.ts` (the runtime `declare global`) and `client/src/renderer/env.d.ts` (for the renderer's tsconfig). Both must stay in sync. The renderer file also needs `/// <reference types="vite/client" />` for `import.meta.env`.
26. **electron-builder workspace hoisting** — npm workspaces hoist `electron` to root `node_modules/`, but electron-builder expects it in `client/node_modules/`. Fix: `electronVersion` is pinned to `"35.7.5"` in `client/package.json` build config so electron-builder downloads its own copy. If you upgrade Electron, update both `devDependencies.electron` and `build.electronVersion`.
27. **electron-builder native module rebuild fails (Python 3.12)** — `node-gyp` v9.x uses `distutils.version.StrictVersion` which was removed in Python 3.12. `npmRebuild: false` in the build config skips this. Native modules (`bufferutil`, `utf-8-validate`, `utp-native`) use prebuilt binaries via `prebuild-install` so compilation is unnecessary.
28. **electron-builder winCodeSign symlink error** — The winCodeSign tool archive contains macOS symlinks that can't be created on Windows without Developer Mode or admin privileges. `signAndEditExecutable: false` in the win config skips the winCodeSign download entirely. Without a code signing certificate this is the correct setting. Side effect: the raw `BoilerDeck.exe` won't show the custom icon in Explorer (but the NSIS installer itself works fine).
29. **Electron icon must be 256x256+** — electron-builder rejects icons smaller than 256x256. The placeholder icon is at `client/resources/icon.ico` (256x256 BMP-in-ICO). Replace with real branding when available.
30. **Windows SmartScreen warning** — The installer is not code-signed, so Windows SmartScreen will show "Windows protected your PC." Users click "More info" → "Run anyway." This is expected until an EV code signing certificate is purchased.
31. **`release/` directory** — electron-builder outputs to `client/release/`. This is gitignored. Never commit build artifacts.
32. **Helmet CORP blocks Electron** — Default `helmet()` sets `Cross-Origin-Resource-Policy: same-origin`, which blocks API responses in Electron's `file://` origin even when CORS headers are correct. Fix: `helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } })` in `server/src/index.ts`. This is NOT a CORS issue — it's a separate header enforced by the browser/Electron renderer before the response body is handed to JS.
33. **Server error response shape** — The server returns `{ error: { code, message } }`, not `{ message }`. All API clients must check `body.error?.message || body.message || res.statusText` in that order. The `|| body.message` fallback exists for backward compatibility; prefer `body.error?.message` for new code.
34. **Licenses endpoint wraps array** — `GET /api/licenses` returns `{ licenses: [...] }`, not a bare array. Code consuming this endpoint must unwrap: `const licenses = data.licenses`. `Array.isArray()` guards are advisable before calling array methods.
35. **JWT stale after server-side role change** — When the server upgrades a user's role (e.g., `POST /developer/register`), the existing JWT still carries the old role claim. Subsequent requests guarded by `requireRole("DEVELOPER")` will return 403. Fix: call `refreshAccessToken()` immediately after any role-changing operation on the client.
36. **React StrictMode double-fires effects** — In development, React 18+ runs effects twice. Any effect that makes a mutating API call (e.g., token rotation using `delete` by ID) will race and crash on the second call if the first already consumed the resource. Fix: use `deleteMany` instead of `delete` for idempotent operations, or guard with a ref flag.
37. **Transmission cleared, fresh torrents only** — As of 2026-03-17, Transmission was cleared of old test torrents. Only torrents added via the upload pipeline are present. If re-seeding manually, use the upload pipeline or `transmission-remote --add` with the .torrent file from the DB.
38. **Transmission doesn't persist torrents across restarts** — The manually-started `transmission-daemon` (PID-based, not systemd — systemd service times out) does NOT reliably persist added torrents. After any Transmission restart, torrents must be re-added. The upload pipeline's `addToTransmission()` is fire-and-forget (errors logged but non-fatal), so uploads succeed even if Transmission is down. **To re-add a torrent:** extract base64 from DB (`SELECT encode(torrent_file, 'base64') FROM torrents WHERE id = '...'`), then POST to Transmission RPC with `download-dir: /opt/boilerdeck/games` (NOT `/opt/boilerdeck/games/<slug>` — the torrent's internal root folder provides the slug directory). See re-seeding script below.
39. **WebTorrent download path — do NOT append game slug** — `wt.add(source, { path })` creates the torrent's internal root folder (named after the game slug) inside `path`. If you pass `installDir/slug` as path, you get `installDir/slug/slug/...` (double nesting). Pass `installDir` as the WebTorrent download path; the install path (for the game registry) is `installDir/slug`.
40. **WebTorrent must be destroyed after download completes** — `torrent.destroy({ destroyStore: false })` releases file handles without deleting downloaded files. Without this, the exe stays locked (EBUSY) and the game can't be launched. The client no longer seeds after download — acceptable for a game distribution client.
41. **Stale Electron processes on Windows** — Closing the Electron window doesn't always kill the main process (especially in dev mode). Multiple zombie Electron processes accumulate, each holding WebTorrent file locks. Before debugging EBUSY errors, run `tasklist //FI "IMAGENAME eq electron.exe"` and kill all instances with `taskkill //F //IM electron.exe`.
42. **Exe auto-detection is recursive** — `detectExecutable()` in `catalog/service.ts` walks subdirectories to find `.exe` files. Game uploads often nest files (e.g., `PeerPlayBuild/Game.exe`). The detected path is stored relative to the game's root directory (e.g., `PeerPlayBuild/Game.exe`), and the client joins it with the install path at launch time.
43. **Refresh token race condition (client-side)** — All API clients (client, web, dev-portal) use a `refreshPromise` lock to serialize concurrent refresh calls. Without this, two simultaneous 401 responses both trigger `refreshAccessToken()`, the second one sends the already-rotated token, gets 401, and **deletes the new token** stored by the first call — logging the user out. This is different from gotcha #36 (server-side `deleteMany`).
44. **Publish endpoint is PATCH, not POST** — `PATCH /developer/games/:id/publish` and `PATCH /developer/games/:id/unpublish`. Using POST returns 404 with an HTML error page ("Cannot POST ...").
45. **addToTransmission silently fails for large torrents** — The upload pipeline's `addToTransmission()` sends base64-encoded torrent data via curl. For large games (hundreds of MB), the base64 string can exceed bash's argument length limit (~2 MB). The upload succeeds (game + torrent in DB) but Transmission never receives the torrent. **Always run `scripts/reseed-torrents.sh` after uploading games.** The reseed script works around this by writing base64 to a temp file and using `curl -d @file`.
46. **Games created in DRAFT status** — The `POST /developer/games` endpoint creates games with status `DRAFT`. They must be explicitly published via `PATCH /developer/games/:id/publish` to appear in the store listing. The `upload-games.mjs` script handles this automatically.
47. **Updater IPC events must use ref guard** — The Settings page update UI subscribes to 5 IPC events (`update-available`, `update-not-available`, `update-progress`, `update-downloaded`, `update-error`). React StrictMode double-fires effects, which would register duplicate listeners. The `listenersAttached` ref flag prevents this. Cleanup calls `removeUpdateListeners()` which removes all 5 at once.

48. **TopSeedersSection must filter by infoHash, not slug** — Attestation events use the torrent's `infoHash` as the `d` tag, not the game slug. The game detail API now includes `infoHash` in `latestVersion` (via Prisma join through version→torrent). The component accepts `infoHash` as a prop and filters by exact `d` tag match.
49. **`@rollup/rollup-linux-x64-gnu` missing on VPS** — Windows-generated `package-lock.json` won't include Linux Rollup binding. If Vite build fails on VPS: `npm install @rollup/rollup-linux-x64-gnu`.
50. **RELAY_ADMIN_PRIVKEY angle brackets** — Env var templates use `<paste hex here>`. Zod regex `/^[0-9a-f]{64}$/` rejects angle brackets, crashing the server. Always strip angle brackets from pasted values.
51. **Bio section hidden when empty** — Profile page must always show the bio section, with italic "No bio yet." placeholder when no kind 0 profile event exists. Using `{bio && <p>...}` hides the section entirely.
52. **Compiled preload.js can go stale** — The Electron main process (`client/dist/main/`) is compiled from TypeScript via `tsc -p tsconfig.main.json`. Vite only hot-reloads the renderer (React). If you modify `preload.ts` or any `client/src/main/` file, the compiled output won't update until you manually recompile. Symptoms: `window.boilerdeck.X.Y is not a function` errors at runtime despite correct source code. **Always recompile after main process changes.**
53. **Locker sync WebSocket race (StrictMode)** — React StrictMode double-fires effects, causing `startLockerSync()` to be called twice in rapid succession (mount → cleanup → mount). The second `startLockerSync` must call `stopLockerSync` first, and `stopLockerSync` must wrap `ws.close()` in try/catch since the WebSocket may still be in CONNECTING state (readyState 0). Without this, Electron shows a "WebSocket is not open" error dialog.
54. **WebTorrent torrent creation timeout scales with file size** — `createTorrentFromFile()` hashes the entire file to compute piece hashes. A 1.4GB file takes ~45s. Flat timeouts (e.g., 30s) cause "client already destroyed" errors when the timeout fires, destroys the client, and then the `ready` event tries to use it. Fix: scale timeout by file size and use a `settled` boolean guard to prevent the race.
55. **Self-custody locker uploads must save to local index immediately** — `uploadFileSelfCustody()` must call `lockerStore.upsertEntry()` + `emitSyncUpdate()` right after creating the entry. Without this, the entry only appears if the relay round-trip succeeds (publish event → sync subscription picks it up), which often fails if the relay is disconnected. The local index is the source of truth for the UI.

---

## Electron Build & Release Pipeline

### Local Build
```bash
cd /c/Users/eface/peerplay/client
npm run build:electron          # Vite build (renderer) + tsc (main process)
../node_modules/.bin/electron-builder          # Windows: NSIS installer + portable exe → client/release/
../node_modules/.bin/electron-builder --linux  # Linux: AppImage + deb → client/release/
../node_modules/.bin/electron-builder --dir    # Unpacked build only (fast, for testing)
```

**Output files** (in `client/release/`):
- `BoilerDeck Setup 0.1.0.exe` — NSIS installer (GUI wizard, directory picker) [Windows]
- `BoilerDeck 0.1.0.exe` — Portable exe (no install needed) [Windows]
- `BoilerDeck-X.Y.Z.AppImage` — Self-contained portable binary [Linux]
- `BoilerDeck_X.Y.Z_amd64.deb` — Debian/Ubuntu package [Linux]
- `latest.yml` — electron-updater auto-update manifest (Windows)
- `latest-linux.yml` — electron-updater auto-update manifest (Linux)
- `win-unpacked/` — Unpacked app (for quick testing: `release/win-unpacked/BoilerDeck.exe`)

**Important:** Run electron-builder via `../node_modules/.bin/electron-builder`, NOT `npx electron-builder` — npx may resolve a different (incompatible) version from the npm cache.

### Publishing a Release
```bash
# Option A: Manual (local build + gh CLI)
cd /c/Users/eface/peerplay/client
npm run dist                    # builds everything
gh release create v0.x.x \
  "release/BoilerDeck Setup 0.x.x.exe#BoilerDeck-Setup-0.x.x.exe" \
  "release/BoilerDeck 0.x.x.exe#BoilerDeck-Portable-0.x.x.exe" \
  "release/latest.yml" \
  --title "BoilerDeck v0.x.x" --notes "Release notes here"

# Option B: Automated (CI)
git tag v0.x.x && git push origin v0.x.x
# GitHub Actions (.github/workflows/build-client.yml) builds + publishes automatically
```

### CI Workflow (`.github/workflows/build-client.yml`)
- **Triggers:** tag push matching `v*`, or manual `workflow_dispatch`
- **Jobs:** `build-windows` (`windows-latest`) + `build-linux` (`ubuntu-latest`) — run in parallel
- **Publishes:** `--publish onTagOrDraft` — only creates GitHub Release when triggered by a tag (not on manual dispatch). Both jobs upload to the same release.
- **Auth:** Uses built-in `GITHUB_TOKEN` (no custom secrets needed)

### Version Bumping
The version in `client/package.json` (`"version": "0.2.0"`) controls the installer filename and auto-update version comparison. The git tag should match (e.g., `v0.2.0`). Bump both together.

### Current Release
- **v0.4.0** — https://github.com/EthanGeisler/peerplay/releases/tag/v0.4.0
- Published 2026-03-19, built via CI (GitHub Actions on `v0.4.0` tag push)
- Windows: NSIS installer (~95MB) + portable exe + blockmap (delta updates)
- Linux: AppImage + deb (added post-v0.4.0, will be in next release)
- Not code-signed (SmartScreen warning expected)
- Includes: Phase 9 Data Locker (encrypted file storage, NIP-44 encryption, sharing, offline queue, batch operations, keyboard shortcuts)
- VPS download: `https://boilerdeck.com/downloads/BoilerDeck%20Setup%200.4.0.exe`
- **v0.3.1** — superseded, auto-update prompts users to v0.4.0
- **v0.3.0** — BURNED (runtime crash from ESM-only `socks-proxy-agent@9` inside asar). Do not distribute.
- **v0.2.1** — superseded
- **v0.2.0** — superseded
- **v0.1.0** — superseded

### Auto-Update (electron-updater) — fully working
- **Main process** (`client/src/main/index.ts` `setupAutoUpdater()`): checks GitHub Releases on startup, auto-downloads in background. Forwards 5 events to renderer: `app:update-available`, `app:update-not-available`, `app:update-progress` (percent/speed/transferred/total), `app:update-downloaded`, `app:update-error`. Also has `app:check-for-update` IPC handler for manual checks.
- **Preload bridge** (`client/src/main/preload.ts`): exposes `updater.checkForUpdate()`, `onUpdateAvailable()`, `onUpdateNotAvailable()`, `onUpdateProgress()`, `onUpdateDownloaded()`, `onUpdateError()`, `removeUpdateListeners()`, `restartForUpdate()`
- **UI — Banner** (`client/src/renderer/components/UpdateBanner.tsx`): banner appears at top of window with version number + "Restart to Update" button → calls `autoUpdater.quitAndInstall()`
- **UI — Settings page** (`client/src/renderer/pages/Settings.tsx`): Manual "Check for Updates" button with progress bar (percent, speed, transferred/total), "Restart to Update" button (disabled until download complete), status messages (checking/downloading/ready/up-to-date/error). Uses `listenersAttached` ref guard to prevent React StrictMode double-registration.
- **Config:** `autoDownload: true` (silent), `autoInstallOnAppQuit: true`
- **Skipped in:** dev mode and E2E tests (`isDev || process.env.ELECTRON_E2E`)
- **Delta updates:** `.blockmap` files enable partial downloads — only changed blocks are fetched, not the full installer

### Download Buttons (Web Storefront)
- **Header button** (`web/src/App.tsx`): Green "Download for Windows" button, text hidden below 768px via CSS `.download-label` class
- **Store page banner** (`web/src/pages/Store.tsx`): Full-width CTA banner below search bar, hidden during search, wraps on mobile via `flexWrap`
- Both link to `/downloads/BoilerDeck%20Setup%200.3.1.exe` — served directly from VPS. nginx serves from `/opt/boilerdeck/downloads/` with `Content-Disposition: attachment`.

### Releasing a New Client Version (full process)
```bash
# 1. Bump version in client/package.json (e.g., 0.3.1 → 0.4.0)
# 2. Update download links in web/src/App.tsx and web/src/pages/Store.tsx
# 3. Commit + push + tag
git add client/package.json web/src/App.tsx web/src/pages/Store.tsx
git commit -m "Bump client version to X.Y.Z and update download links"
git push origin main
git tag vX.Y.Z && git push origin vX.Y.Z
# 4. CI builds (~3-5 min) — creates a DRAFT GitHub Release
gh run watch $(gh run list --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
# 5. CRITICAL: Publish the release (CI creates it as DRAFT — auto-updater can't see drafts!)
gh release edit vX.Y.Z --draft=false
# 6. Download installer from GitHub Release
gh release download vX.Y.Z -p "BoilerDeck-Setup-X.Y.Z.exe" -D /tmp
# 7. Upload to VPS (NOTE: GitHub uses hyphens, VPS needs spaces to match URL-encoded links)
ssh root@204.168.133.38 "mkdir -p /opt/boilerdeck/downloads"
scp /tmp/BoilerDeck-Setup-X.Y.Z.exe "root@204.168.133.38:/opt/boilerdeck/downloads/BoilerDeck Setup X.Y.Z.exe"
# 8. Deploy updated web storefront (may need: npm install @rollup/rollup-linux-x64-gnu)
ssh root@204.168.133.38 "cd /opt/boilerdeck && git pull origin main && npx vite build web"
```
**Gotcha:** CI uses `electron-builder --publish onTagOrDraft` which creates **draft** releases. The `electron-updater` auto-update client ignores drafts — you MUST publish the release with `gh release edit --draft=false` or users won't see the update.
**Gotcha:** GitHub Release assets use hyphens (`BoilerDeck-Setup-0.2.1.exe`) but the VPS download links use spaces (`BoilerDeck%20Setup%200.2.1.exe`). Must rename when SCP-ing to VPS.
**Gotcha:** The `/opt/boilerdeck/downloads/` directory may not exist after VPS rebuild — create with `mkdir -p` before SCP.
**Gotcha:** VPS `package-lock.json` from Windows may lack `@rollup/rollup-linux-x64-gnu`. If Vite build fails, run `npm install @rollup/rollup-linux-x64-gnu` first.

---

## Git State

- **Repo:** https://github.com/EthanGeisler/peerplay (rename pending — GitHub repo still named `peerplay`)
- **Branch:** `main` (only branch)
- **40+ commits** as of 2026-03-17 (latest first):
  1. `440a016` `Fix review issues: token race condition, error handling, DRM badges`
  2. `b063233` `Fix cover images in Electron client and add store link to dev portal setup`
  3. `6082929` `Fix cover image upload field name mismatch`
  4. `f8346ca` `Update docs with v0.2.0 release, auto-update details, and release process`
  5. `912f091` `Bump client version to 0.2.0 and update download links`
  6+ (earlier commits omitted — see `git log` for full history)
- **Git identity:** `EthanGeisler` / `25466222+EthanGeisler@users.noreply.github.com`
- **Tags:** `v0.1.0` (first release), `v0.2.0` (auto-update, bug fixes), `v0.2.1` (Phase 1-2, DRM removal), `v0.3.0` (burned — asar crash), `v0.3.1` (current release — Phase 6 Privacy Layer)

---

## Codebase Refactoring (2026-03-18) — Committed & Deployed

Commit `f09ad3a` — major maintainability refactoring. Key changes:
1. **`shared-ui/` (`@boilerdeck/ui-shared`)** — shared API client with `TokenStorage` adapter. Each frontend's `api.ts` is a thin wrapper.
2. **`handleZodError`** extracted to `shared/src/errors.ts` (was duplicated in 3 route files)
3. **`dev-portal/src/types.ts`** — 10 interfaces extracted from inline definitions
4. **`catalog/src/service.ts`** split into `service.ts` (game CRUD) + `upload.ts` (zip/exe/Transmission)
5. **GameEditor** split into sub-components: `GameEditorForm`, `UploadManager`, `ExeDetector` (both dev-portal and client)
6. **Phase 1 spec** archived to `docs/Phase_1_Spec.md`
7. **Bug fixes:** cover upload field name `"coverImage"` → `"cover"`, apiUpload error parsing

See `CLAUDE.md` for updated conventions reflecting these changes.

---

## Decentralization Initiative — Current Status

> **Master plan:** `DECENTRALIZATION_PLAN.md` (8 phases, full sub-task breakdown)
> **Verification:** `VERIFICATION_CHECKS.md` (pass/fail checks per sub-task, gate checks between phases)
> **Verify agent:** `.claude/agents/verify.md` — run `@verify <sub-task-id>` to check implementation

### Progress

| Sub-task | Description | Status | Commit |
|----------|-------------|--------|--------|
| 1.1 | Add crypto dependencies | DONE | `cc37ab3` |
| 1.2 | Crypto utility module | DONE | `f32e712` |
| 1.3 | Database migration (keypair columns) | DONE | `0b67c21` |
| 1.4 | Generate keypair on registration | DONE | `0914130` |
| 1.5 | Cache signing key on login + pubkey in JWT | DONE | `acd966e` |
| 1.6 | Lazy keypair migration + recover-mnemonic | DONE | `8227103` |
| 1.7 | Challenge-based login (sovereign mode) | DONE | `4f22f64` |
| 1.8 | Key export + custody switch | DONE | `4f20e9e` |
| 1.9 | Frontend: mnemonic modal on registration (web) | DONE | `3faf876` |
| 1.10 | Frontend: mnemonic modal on login migration (web) | DONE | `84f90a0` |
| 1.11 | Electron client: mnemonic flow | DONE | `dede4dd` |
| 1.12 | Electron client: client-side keypair generation | DONE | `9d00e34` |
| 1.13 | Password change flow | DONE | `ad69472` |
| 2.1 | Create events table migration | DONE | `4bb9c6d` |
| 2.2 | Event utility module | DONE | `cfdda0c` |
| 2.3 | Event storage service | DONE | `1c33b09` |
| 2.4 | Server-side signing service | DONE | `30c3402` |
| 2.5 | Wrap game creation in event signing | DONE | `5e84a4c` |
| 2.6 | Wrap game updates/publishing in event signing | DONE | `d43f85a` |
| 2.7 | Wrap version upload in event signing | DONE | `d43f85a` |
| 2.8 | REST endpoint for pre-signed events | DONE | `b612daa` |
| 2.9 | Event materialization layer | DONE | `fe6d154` |
| 2.10 | Add pubkey to public API responses | DONE | `c83b1c1` |
| 2.11 | Frontend types and API updates | DONE | `46ad4ec` |
| 3.1 | Relay: event schema + crypto utilities | DONE | `88bdfd5` |
| 3.2 | Relay: Prisma schema compound index | DONE | `88bdfd5` |
| 3.3 | Relay: package skeleton (service + routes) | DONE | `88bdfd5` |
| 3.4 | WebSocket relay endpoint | DONE | `e562fd4` |
| 3.5 | Key management endpoints | DONE | `46df7e8` |
| 3.6 | Sign-and-publish + WS broadcast | DONE | `abe878c` |
| 3.7 | Electron relay connection manager | DONE | `2f5d55e` |
| 3.8 | External relay federation (outbound) | DONE | `2248cd6` |
| 3.9 | External relay federation (inbound) | DONE | `2248cd6` |
| 3.10 | Relay discovery + NIP-11 | DONE | `3e99211` |
| 4.1 | Event kind definitions and validation | DONE | Phase 4 batch |
| 4.2 | Profile events (kind 0) | DONE | Phase 4 batch |
| 4.3 | Review events (kind 31337) | DONE | Phase 4 batch |
| 4.4 | Review display UI | DONE | Phase 4 batch |
| 4.5 | Review submission UI | DONE | Phase 4 batch |
| 4.6 | Follow list events (kind 3) | DONE | Phase 4 batch |
| 4.7 | User profile page | DONE | Phase 4 batch |
| 4.8 | Comment events (kind 1 with tags) | DONE | Phase 4 batch |
| 4.9 | Moderation: mute and report | DONE | Phase 4 batch |
| 5.1 | Attestation event validation | DONE | Phase 5 batch |
| 5.2 | Electron auto-generate attestations | DONE | Phase 5 batch |
| 5.3 | VPS seed box attestation | DONE | Phase 5 batch |
| 5.4 | Reputation aggregation service | DONE | Phase 5 batch |
| 5.5 | Reputation display in UI | DONE | Phase 5 batch |
| 5.6 | Web of trust weighting | DONE | Phase 5 batch |
| 7.1–7.12 | Content generalization (Phase 7) | DONE | `e8284a3` |

### Implementation Workflow

For each sub-task, follow this exact sequence:

```
1. Read ALL existing handoff docs in docs/handoff/
2. Implement the sub-task
3. Write handoff doc at docs/handoff/<sub-task-id>.md (see template in DECENTRALIZATION_PLAN.md)
4. @verify <sub-task-id>     ← runs checks from VERIFICATION_CHECKS.md
5. Fix any failures, re-verify
6. /commit-push-pr           ← commit and push (handoff doc included in commit)
7. @deploy                   ← deploy to VPS
```

### Workflow Gotchas (learned from 1.1)

- **Verification checks can be stale.** `@noble/hashes` v2 renamed `sha512` to `sha2.js` — the check was written for v1. When a check fails, determine whether the *code* or the *check* is wrong. Fix whichever is incorrect.
- **Cross-phase invariants that need a running server are skipped** when no DB is available. These become critical starting at sub-task 1.3 (database migration).
- **The verify agent is read-only.** It reports failures but does not fix them. Control returns to the implementing agent/conversation.
- **Deploy is optional for non-runtime changes** (e.g., 1.1 only added deps). But running it validates the pipeline.

### Key Libraries Installed (Phase 1.1)

These are in `server/packages/auth/package.json`. See `docs/handoff/1.1.md` for full details including import path gotchas.
- `@noble/curves` ^2.0.0 — secp256k1 + Schnorr signatures (import from `@noble/curves/secp256k1.js`)
- `@noble/hashes` ^2.0.1 — SHA-256 (import from `@noble/hashes/sha2.js`, NOT `sha256`)
- `@scure/bip32` ^2.0.1 — BIP32 HD key derivation for NIP-06 (`m/44'/1237'/0'/0/0`)
- `@scure/bip39` ^2.0.1 — BIP39 mnemonic generation (12-word recovery phrases)
- `@scure/base` ^2.0.0 — Hex/bech32 encoding (npub/nsec)

### Phase 3 COMPLETE — Relay Infrastructure

The `@boilerdeck/relay` package includes:
- **crypto.ts** — re-exports from shared + auth (no duplication)
- **types.ts** — NIP-01 protocol message types (ClientMessage, RelayMessage, Subscription, EventFilter)
- **service.ts** — wraps shared eventStore + adds `deleteEvent`
- **routes.ts** — REST endpoints: `/api/events` CRUD, `/api/relay/me/keys`, `/api/relay/me/import-key`, `/api/events/sign-and-publish`, `/api/relay/info`, NIP-11 handler
- **ws.ts** — NIP-01 WebSocket relay at `/relay` with REQ/EVENT/CLOSE, subscription management, fan-out (exported)
- **federation.ts** — outbound + inbound federation with external relays, loop prevention, auto-reconnect
- **Compound index** `[kind, createdAt]` on events table for efficient relay queries
- **Nginx** WebSocket proxy configured on VPS for `wss://boilerdeck.com/relay`
- **Electron client** `relayManager.ts` — relay connection manager with auto-reconnect, IPC bridge

### Phase 4 COMPLETE — Social Features (2026-03-18)

All 9 sub-tasks (4.1–4.9) implemented and deployed. Handoff docs: `docs/handoff/4.1.md` through `4.9.md`.

**New relay package files:**
- **`kinds.ts`** — Event kind constants + per-kind validation. Kinds: 0 (profile), 1 (text note), 3 (follow list), 5 (deletion), 7 (reaction), 31337 (review), 31338 (attestation)

**New REST endpoints (all in `relay/src/routes.ts`):**
- `PUT /api/profiles/me` — create/update kind 0 profile event
- `GET /api/profiles/:pubkey` — fetch latest profile
- `POST /api/games/:slug/reviews` — submit kind 31337 review (requires license ownership)
- `GET /api/games/:slug/reviews` — reviews with averageRating, reviewCount, pagination
- `POST /api/follows` — create/update kind 3 follow list
- `GET /api/follows/:pubkey` — list followed pubkeys
- `DELETE /api/follows/:pubkey` — unfollow
- `POST /api/events/:eventId/replies` — kind 1 reply with `["e", parentId]` tag
- `GET /api/events/:eventId/replies` — threaded replies
- `POST /api/moderation/mute` — add to mute list (Redis set)
- `DELETE /api/moderation/mute/:pubkey` — unmute
- `POST /api/moderation/delete` — admin deletion via kind 5 event

**New frontend components (web + client mirrors):**
- `ReviewSection.tsx` — displays reviews with stars, pagination, "Load More"
- `ReviewForm.tsx` — star selector, title, body, submit (only if logged in + owns game + hasn't reviewed)
- `Profile.tsx` — route `/profile/:pubkey`, display name, bio, avatar, follow/unfollow, review count

**Key design decisions:**
- Electron client signs reviews locally via cached privkey + Schnorr, publishes via relay WS
- `fanOutEvent()` in ws.ts is async — filters muted pubkeys via Redis SISMEMBER before fan-out
- Regular replaceable kinds (0, 3) handled by extending `shared/src/events.ts` with `isRegularReplaceableKind()`
- `RELAY_ADMIN_PRIVKEY` env var (64-char hex) — relay's own keypair for admin-level kind 5 deletion events

**Env vars added on VPS:**
- `RELAY_ADMIN_PRIVKEY` — 64-char hex, relay's admin signing key

**Test data on VPS:**
- 3 reviewer accounts: `reviewer1@test.com`, `reviewer2@test.com`, `reviewer3@test.com` (password: `testpass123`)
- 3 reviews on OpenTTD game

### Phase 5 COMPLETE — Seeding Reputation (2026-03-18)

All 6 sub-tasks (5.1–5.6) implemented and deployed. Handoff docs: `docs/handoff/5.1.md` through `5.6.md`.

**New relay package files:**
- **`attestationValidation.ts`** — async DB-dependent validation for kind 31338: unknown infoHash check (queries Torrent table), bytesDownloaded vs torrent file size
- **`reputation.ts`** — `getReputation(pubkey, viewerPubkey?)`: logarithmic scoring formula `sum(log2(1 + MB_weight))`, anti-sybil (accounts < 7 days = 0.1x, max 20 attestations per attester per day), Redis caching (15min TTL)

**New REST endpoint:**
- `GET /api/reputation/:pubkey` — returns `{ pubkey, score, attestationCount, uniqueAttesters }`, optional `?viewer=<pubkey>` for personalized web-of-trust weighting

**New client files:**
- **`client/src/main/attestation.ts`** — `publishAttestation()` creates kind 31338 events after torrent download completes. Signs locally with cached privkey, publishes via relay WebSocket. Uses developer pubkey for `p` tag.

**New scripts:**
- **`scripts/seed-attestation-cron.ts`** — VPS seed box attestation: reads `VPS_SEED_PRIVKEY`, queries Transmission RPC for completed transfers, creates kind 31338 events. Run: `VPS_SEED_PRIVKEY=<hex> npx tsx scripts/seed-attestation-cron.ts`

**UI additions (web + client):**
- Profile page shows "Seeder Reputation" section: score, badge (Bronze ≥10, Silver ≥50, Gold ≥200), attestation count, unique attesters
- Game detail page shows "Top Seeders" section: ranked by reputation score, filtered by game's `infoHash`
- Badge system with gold/silver/bronze visual styling

**Key design decisions:**
- Attestation `p` tag uses game developer's pubkey (the content creator), NOT the seed box's own pubkey — avoids self-attestation rejection
- `torrentManager.ts` calls `publishAttestation()` in torrent `done` handler (non-fatal, `.catch()`)
- Game detail API now includes `infoHash` in `latestVersion` (added via Prisma join through version→torrent relation)
- Web of trust: follow = 1.0x weight, unknown = 0.25x, muted = 0x — personalized via `?viewer=` query param
- Separate Redis cache keys for personalized vs global scores

**Env vars added on VPS:**
- `VPS_SEED_PRIVKEY` — 64-char hex, seed box's signing key for attestation events

See `docs/handoff/5.6.md` for latest implementation details.

---

### Phase 6 — Privacy Layer (6.1–6.7) — COMPLETE (v0.3.1, deployed 2026-03-19)

**What it does:** Optional Tor/SOCKS5 proxy support in the Electron client. Users can route API traffic and BitTorrent tracker announces through a proxy to hide their IP.

**Key files:**
- **`client/src/main/proxyManager.ts`** — `getProxyAgent(settings)` returns SOCKS5 agent for Tor or custom proxy. `testProxyConnection()` verifies proxy works. Uses **dynamic `import("socks-proxy-agent")`** — see "ESM in asar" gotcha below.
- **`client/src/main/torManager.ts`** — `startTor()`, `stopTor()`, `isTorRunning()`, `getTorStatus()`. Spawns `tor.exe` from extraResources, parses bootstrap progress, 60s timeout.
- **`client/src/main/torrentManager.ts`** — Privacy-aware client: disables DHT/LSD/UTP, proxies tracker announces when SOCKS5 + `routeTorrentTraffic` enabled.
- **`client/src/main/index.ts`** — IPC handlers: `privacy:get-settings`, `privacy:save-settings`, `privacy:get-status`, `privacy:test-connection`, `api:proxied-fetch`, `tor:start`, `tor:stop`, `tor:status`
- **`client/src/renderer/pages/Settings.tsx`** — "Privacy & Network" section: radio group (Off/Tor/SOCKS5), SOCKS5 fields, routing checkboxes, test connection button, Tor bootstrap progress
- **`client/src/renderer/api.ts`** — `shouldProxyApi()`, `proxiedApiFetch()`, `discoverOnionAddress()`, `getEffectiveApiBase()`
- **`server/packages/shared/src/config.ts`** — `ONION_ADDRESS` optional Zod field
- **`server/packages/relay/src/routes.ts`** — relay info includes `onion_address` when configured
- **`docs/privacy.md`** — comprehensive privacy documentation
- **`client/resources/tor/`** — placeholder for Tor Expert Bundle (tor.exe not committed, must be placed manually)

**Critical gotcha — ESM-only packages in asar:**
`socks-proxy-agent@9` and `agent-base@8` are ESM-only (their `exports` field only has an `"import"` condition, no `"require"`). The Electron main process compiles to CJS (`require()`). On a real filesystem Node 22's `require(esm)` handles this, but inside Electron's asar virtual filesystem it crashes with "No 'exports' main defined". **Fix:** Use `await import("socks-proxy-agent")` (dynamic import) instead of static `import { SocksProxyAgent } from "socks-proxy-agent"`. Dynamic `import()` always uses the ESM resolver even in CJS output. This made `getProxyAgent()` async — all callers use `await`.

**Limitations:**
- WebTorrent doesn't support SOCKS5 for peer-to-peer TCP connections — only tracker HTTP announces are proxied
- Tor mode never routes torrent traffic (too slow for game downloads) — only API traffic
- `tor.exe` must be manually placed in `client/resources/tor/` from the Tor Expert Bundle (not committed to repo)

See `docs/handoff/phase-6-summary.md` and `docs/handoff/6.1.md` through `6.7.md` for full implementation details.

### Phase 7 COMPLETE — Content Generalization (deployed 2026-03-19)

All 12 sub-tasks (7.1–7.12) implemented in a single commit (`e8284a3`), deployed as Batch C.

**What changed — the naming layer:**
- Prisma models renamed: `Game` → `Listing`, `GameVersion` → `ListingVersion`, `GameStatus` → `ListingStatus`
- `@@map` preserves all DB table/column names — **zero SQL migration for the rename**, only one migration for adding the `content_type` enum column and `metadata` JSON column
- FK field names (`gameId`) stay as-is with `@map("game_id")` — minimizes blast radius
- All renamed functions/types have backwards-compatible aliases (e.g., `listPublishedGames = listPublishedListings`, `ApiGame = ApiListing`)
- Old `/games` API routes kept working alongside new `/listings` routes

**What changed — content type system:**
- `ContentType` enum: `GAME`, `VIDEO`, `SOFTWARE`, `AUDIO`, `OTHER` (defaults to `GAME`)
- `metadata` JSON field on Listing model (defaults to `{}`) — for future type-specific metadata
- Server: `listPublishedListings()` accepts optional `contentType` filter; upload pipeline skips exe detection for non-GAME; multer accepts zip + media files
- All 3 frontends: content type filter tabs on Store pages, content-type-aware detail pages (badges, conditional exe info), content type selector in editor forms (locked after creation), Copy Protection/ExeDetector only shown for GAME/SOFTWARE

**New files:**
- `client/src/main/mediaServer.ts` — local HTTP server for video streaming (Content-Range/206 Partial Content support)
- `client/src/renderer/components/VideoPlayer.tsx` — HTML5 video player using IPC bridge to media server
- `server/prisma/migrations/20260319011415_add_content_type_and_metadata/migration.sql`

**New API routes (alongside existing `/games` routes):**
- `GET /api/listings?contentType=GAME&limit=50` — filtered listing browse
- `GET /api/listings/:slug` — listing detail
- `POST /api/developer/listings` — create listing with optional `contentType`
- `PUT /api/developer/listings/:id` — update listing
- Full CRUD + upload + cover + publish/unpublish mirrored from `/developer/games`
- `GET /api/listings/:slug/reviews` — redirects to `/games/:slug/reviews`

**New IPC channels (Electron):**
- `media:get-file-path` — scans install dir for media files (mp4/webm/mkv/mp3/wav/ogg/flac)
- `media:start-server` — starts local media server, returns streaming URL

**Upload script:** `scripts/upload-games.mjs` now uses `/developer/listings` routes and supports `contentType` in manifest.

**Dev-portal:** Removed dead "Games" nav link (pointed to `/games` which had no route — catch-all redirected to Dashboard). Dashboard already shows "Your Listings".

See `docs/handoff/phase-7-summary.md` for full details. See `DECENTRALIZATION_PLAN.md` for Phase 8 specs.

---

## Data Locker (Phase 9 — Complete, client bugs fixed 2026-03-19)

Personal encrypted file storage using Nostr events (NIP-78, kind 30078) + BitTorrent distribution. Users upload files from any device, metadata is NIP-44 encrypted and published to the relay, and the VPS persistently seeds all files.

**Bugs fixed (2026-03-19, PR #2):** Stale compiled preload missing locker IPC channels; WebSocket race condition on tab open (StrictMode double-fire); WebTorrent timeout on large files; self-custody uploads not persisting to local index. See gotchas #52-55 for details. Electron Client Verification checks added to VERIFICATION_CHECKS.md.

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/locker/upload` | Yes | Multipart file upload to locker |
| GET | `/api/locker/entries` | Yes | List user's locker entries (decrypted) |
| DELETE | `/api/locker/entries/:entryId` | Yes | Delete a locker entry (NIP-09) |
| GET | `/api/locker/entries/:entryId/torrent` | Yes | Download .torrent file for entry |
| POST | `/api/locker/share` | Yes | Share entry with another user |
| GET | `/api/locker/shared-with-me` | Yes | Get entries shared with current user |
| DELETE | `/api/locker/share/:shareId` | Yes | Revoke a shared entry |
| GET | `/api/locker/health` | No | Transmission + storage health check |

### Prisma Models

| Model | Table | Purpose |
|-------|-------|---------|
| `LockerFile` | `locker_files` | Tracks uploaded files — userId, entryId, filename, size, sha256, infoHash, torrentPath, filePath, deletedAt (soft delete) |
| `LockerQuota` | `locker_quotas` | Per-user storage quota tracking — usedBytes, maxBytes (default 50 GB) |

### Nostr Event (Kind 30078 — NIP-78)

Locker entries are stored as parameterized replaceable events (NIP-33) with `d`-tag = entry UUID. Content is NIP-44 encrypted JSON of `LockerEntry` type. Tags: `["d", entryId]`, `["t", userTag]` for each user-defined tag. Sharing adds `["p", recipientPubkey]`, `["shared-from", senderPubkey]`, `["shared-entry", originalEntryId]`.

### Key Files

| File | Purpose |
|------|---------|
| `server/packages/shared/src/locker.ts` | `LockerEntry` type, validation, serialization, event tag helpers |
| `server/packages/locker/src/service.ts` | Upload, list, delete, share, torrent retrieval orchestration |
| `server/packages/locker/src/routes.ts` | Express REST routes |
| `server/packages/locker/src/storage.ts` | File storage, quota management |
| `server/packages/locker/src/dedup.ts` | SHA-256 content deduplication |
| `server/packages/locker/src/seedManager.ts` | Transmission RPC management for locker torrents |
| `server/packages/locker/src/config.ts` | Locker-specific env config |
| `client/src/main/lockerManager.ts` | Client-side upload, download, sync, sharing, offline queue |
| `client/src/main/lockerStore.ts` | Local locker index (JSON file) |
| `client/src/renderer/stores/lockerStore.ts` | Zustand store for UI state |
| `client/src/renderer/pages/LockerPage.tsx` | Desktop locker UI |
| `web/src/pages/LockerPage.tsx` | Web storefront locker (read-only) |
| `docs/locker-security.md` | Security model and threat analysis |

---

## What's Next (Not Yet Built)

Refer to the plan in `.claude/plans/twinkling-hugging-thunder.md` for the full roadmap. Key next steps:

### Short-term
- [x] Connect web storefront to real API (replace mock data with fetch calls) — done 2026-03-16
- [x] Stripe Connect integration (real payments via Stripe Checkout + Connect destination charges) — done 2026-03-16
- [x] Electron client — full build: store browsing, purchase, BitTorrent downloads, game launch, install management, settings
- [x] Developer portal SPA (`dev-portal/`) — manage games, file upload pipeline, version management
- [x] Consolidated hosting — storefront + dev portal + API all on VPS
- [x] Electron build pipeline — NSIS installer + portable exe, GitHub Actions CI, v0.1.0 published
- [x] Download button on web storefront — header button + Store page banner, now served directly from VPS `/downloads/`
- [x] Open-source game library — 6 free GPL games uploaded, cover images added, seeding on VPS (2026-03-17)
- [x] Settings page manual update UI — check for updates button, progress bar, restart button (2026-03-17, in local build, needs v0.2.1 release)
- [x] DRM system removed — platform distributes builds as-is, developers handle copy protection (2026-03-17)
- [x] Commit + deploy DRM removal to VPS (run migration, remove `DRM_MASTER_KEK` from .env, rebuild frontends, restart) — done 2026-03-18
- [x] Cut v0.2.1 release — includes cover image fixes, Settings update UI, DRM removal, Phase 1 identity, and other post-v0.2.0 fixes — done 2026-03-18
- [x] Clean up 6 DRAFT duplicate games from accidental double-upload — deleted via DB 2026-03-18
- [ ] Real cover art / screenshots for Player Character 01 (currently using placehold.co)
- [ ] Real app icon for Electron client (currently a placeholder — `client/resources/icon.ico`)
- [x] Electron client: fetch `.torrent` file from `/api/torrents/:gameId/latest/file` instead of using magnet URI — done 2026-03-17 (client fetches .torrent bytes, falls back to magnet)
- [x] Electron client: end-to-end verified — upload via dev portal, purchase, download via BitTorrent, launch game — done 2026-03-17
- [x] Electron client: catch-all route for 404s — done (App.tsx has `<Route path="*">` with back-to-store link)
- [ ] Electron client: handle duplicate torrent gracefully (currently errors on re-add of same info hash)
- [ ] Electron client: store key whitelist (currently accepts any key — not a security issue since it's local-only, but good hygiene)
- [ ] Electron client: first real end-to-end test (start app, browse store, download a game)

### Medium-term
- [ ] Steam shortcuts.vdf integration (games appear in Steam library)
- [ ] Cloud save sync (Backblaze B2)
- [x] Client auto-update (electron-updater) — fully working as of v0.2.0. Silent background download + UpdateBanner UI + restart-to-install. See "Auto-Update" section above.
- [x] Reviews system — kind 31337 events, review display + submission UI, license ownership gate (2026-03-18)
- [x] Social features — profiles, follows, comments, moderation/mute (2026-03-18)
- [x] Social tab / news feed — Twitter-like feed page with For You + Following tabs, compose box, paginated (2026-03-18)
- [x] Seeding reputation — attestation events, logarithmic scoring, web of trust, top seeders UI (2026-03-18)
- [x] Privacy Layer — Tor/SOCKS5 proxy in Electron client, privacy settings UI, .onion endpoint support (2026-03-19, v0.3.1)
- [ ] Search / categories
- [ ] Private opentracker instance + seed boxes
- [ ] Code signing certificate for Windows installer (removes SmartScreen warning)

### Long-term
- [x] Linux client — AppImage + deb build targets, CI builds in parallel with Windows (2026-03-19). Game launching on Linux deferred (Windows .exe games won't run natively).
- [ ] Mac client
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
| Build workflow (Electron) | `.github/workflows/build-client.yml` |
| Electron build config | `client/package.json` (`"build"` field) |
| Electron app icon | `client/resources/icon.ico` (placeholder — replace with real branding) |
| GitHub Release (current) | https://github.com/EthanGeisler/peerplay/releases/tag/v0.3.1 |
| Auto-update UI component | `client/src/renderer/components/UpdateBanner.tsx` |
| Auto-update main process | `client/src/main/index.ts` (`setupAutoUpdater()`) |
| Electron client API client | `client/src/renderer/api.ts` |
| Electron client types | `client/src/renderer/types.ts` |
| Electron client preload bridge | `client/src/main/preload.ts` |
| Electron client IPC handlers | `client/src/main/index.ts` |
| Electron torrent manager | `client/src/main/torrentManager.ts` |
| Electron persistent store | `client/src/main/store.ts` (JSON at `userData/boilerdeck-config.json`) |
| Full architecture plan | `.claude/plans/twinkling-hugging-thunder.md` |
| Game build (PC01) | `C:\Users\eface\player-character-01\build\PeerPlayBuild\` |
| Game files (VPS) | `/opt/boilerdeck/games/<slug>/` |
| Upload temp (VPS) | `/opt/boilerdeck/games/.tmp/` |
| Game upload script | `scripts/upload-games.mjs` (reads `game-staging/manifest.json`) |
| Cover upload script | `scripts/upload-covers.mjs` |
| Publish drafts script | `scripts/publish-all-drafts.mjs` |
| VPS torrent reseed | `scripts/reseed-torrents.sh` (run via SSH) |
| Game staging dir | `game-staging/` (gitignored, zips + covers + manifest) |
| Settings page (update UI) | `client/src/renderer/pages/Settings.tsx` |
| Torrent scripts (legacy) | `scripts/create-game-torrent.mjs`, `parse-torrent.mjs`, etc. |
| Transmission config | `/root/.config/transmission-daemon/settings.json` (on VPS) |
| Downloads dir (VPS) | `/opt/boilerdeck/downloads/` (installer served at `/downloads/`) |
| Dev portal login | `dev@example.com` / `developer123` (seed data — **DB wiped 2026-03-17, these no longer exist on VPS**) |
| Storefront player login | `player@example.com` / `player123456` (seed data — **DB wiped 2026-03-17, these no longer exist on VPS**) |
