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
| `torrent` | Torrent retrieval with license ownership check, **`createGameTorrent()` for generating .torrent files** (used by catalog upload pipeline), **`getLatestTorrentFile()` for raw .torrent bytes** (used by Electron client) | `src/service.ts`, `src/routes.ts`, `src/vendor.d.ts` |
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
- `GET /api/licenses`, `POST /api/licenses/:gameId/verify` (with device fingerprinting)
- `POST /api/licenses/:gameId/key` (ENCRYPTED DRM — decryption key delivery)
- `DELETE /api/licenses/:gameId/devices/:fingerprint` (device deregistration)
- `POST /api/payments/checkout`, `POST /api/payments/webhook`
- `GET /api/torrents/:gameId/latest` (includes `encrypted` flag + `algorithm` for encrypted games)
- `GET /api/torrents/:gameId/latest/file` (raw `.torrent` bytes, `application/x-bittorrent`, authenticated + license check)
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

### Electron Client — functional (`client/`)

Full desktop client: browse store, purchase games (Stripe Checkout in system browser), download via BitTorrent, DRM enforcement, game launch, install management.

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
| `preload.ts` | `contextBridge.exposeInMainWorld("boilerdeck", {...})` — sections: platform, updater, store, shell, dialog, games, drm, downloads |
| `store.ts` | JSON file persistence at `app.getPath("userData")/boilerdeck-config.json`. Keys: refreshToken, installDir, installedGames, settings, deviceFingerprint |
| `torrentManager.ts` | WebTorrent singleton. `startDownload()` prefers .torrent buffer over magnet. Broadcasts progress every 1s via `mainWindow.webContents.send("downloads:progress-update")`. Sends `downloads:complete` with gameId/title/infoHash/downloadPath on torrent done. |
| `gameLauncher.ts` | `child_process.spawn(exe, [], { detached: true, stdio: "ignore" })` + `child.unref()`. Tracks running games in a Map. `uninstallGame()` uses `fs.promises.rm(path, { recursive: true, force: true })`. |
| `fingerprint.ts` | SHA-256 of `hostname|cpuModel|arch|platform|totalMem`. Cached in memory + persisted to store. |
| `decryptor.ts` | Finds all `.enc` files recursively, reads 16-byte IV prefix, AES-256-CTR decrypt, writes original, deletes `.enc`. |
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
| `installedStore.ts` | `loadInstalled()` (from persistent store), `markInstalled(game)`, `uninstall(gameId)`, `launch(gameId)` (includes DRM verify for LIGHT/ENCRYPTED). |

**Download → Install pipeline (the most complex flow):**
1. User clicks Download → `downloadStore.startDownload()` stores metadata in `downloadMeta` Map, calls IPC `downloads:start`
2. Main process adds torrent to WebTorrent, begins downloading
3. Main process pushes `downloads:progress-update` every 1s → renderer updates progress bars
4. Torrent completes → main sends `downloads:complete` IPC event
5. `downloadStore` completion listener fires:
   - If `drmTier === "ENCRYPTED"`: fetch fingerprint → `POST /licenses/:gameId/key` → `drm.decryptGame()` (main process decrypts all `.enc` files)
   - Calls `installedStore.markInstalled()` with full metadata → persisted to JSON store
6. Game appears in Library with Launch button

**DRM enforcement at launch:**
- `installedStore.launch()` checks `drmTier`
- LIGHT or ENCRYPTED: `POST /licenses/:gameId/verify` with device fingerprint before spawning exe
- Failure returns user-friendly error (device limit reached, no internet, etc.)

**Stripe checkout in client:**
- Free games: `checkout()` returns immediately, `fetchLicenses()` called inline
- Paid games: Opens Stripe Checkout URL in system browser via `shell.openExternal()`, then polls `fetchLicenses()` every 3s for up to 5 minutes

**Build config:**
- `electron-builder` in `client/package.json` — NSIS + portable targets, `asarUnpack` for `webtorrent`/`utp-native` (native deps)
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
| `encrypt-game.mjs` | Encrypts game files with AES-256-CTR, wraps master key with DRM_MASTER_KEK, outputs wrapped key hex + manifest |
| `publish-game-encrypted.mjs` | Publishes an encrypted game (creates EncryptionKey record, sets drmTier ENCRYPTED, creates Torrent + GameVersion) |
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
**Downloads dir:** `/opt/boilerdeck/downloads/` — contains `BoilerDeck Setup 0.1.0.exe` (91MB installer, served at `/downloads/`)
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

**Environment:** `server/.env` — contains DATABASE_URL, REDIS_URL, JWT secrets, Stripe keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PLATFORM_FEE_PERCENT`), `CORS_ORIGIN`, `CORS_ADDITIONAL_ORIGINS` (comma-separated extra origins, e.g. for Electron dev), port config, optional `DRM_MASTER_KEK` (64+ hex chars, required for ENCRYPTED DRM tier). Not committed to git. Separate `.env` exists on VPS at `/opt/boilerdeck/server/.env`.

**VPS `.env` note:** `CORS_ADDITIONAL_ORIGINS="http://localhost:5173"` is set on the VPS to allow Electron dev mode (renderer runs on localhost:5173 in dev, not `file://`).

---

## Games on the Platform

**8 published games** as of 2026-03-17. All seeded from VPS Transmission daemon on `204.168.133.38:6881`.

### Original Games

#### PlayerCharacter01 (Web Build) — legacy, not launchable
- **DB slug:** `playercharacter01-fb92`
- **Info hash:** `9d8949a375b3cede3495e4e56622cb5bc75d791d`
- **DRM:** NONE, Price: $1.00
- **Issue:** This is a Godot web export (index.html + index.wasm). No exe — cannot be launched from the Electron client. Uploaded before we identified the web vs desktop build distinction.

#### PlayerCharacter01 Windows — the working game
- **DB slug:** `playercharacter01-windows-d919`
- **Info hash:** `cf3e503bb6e88f4fcdf2572629173884ec4c4994`
- **Exe path:** `PeerPlayBuild/PLAYER_CHARACTER_01PeerPlay.exe` (set in DB)
- **Size:** ~101MB (3 files: exe, console exe, pck)
- **DRM:** NONE, Price: $1.00
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

All have cover images uploaded. All are free ($0), DRM: NONE.

> **Note:** There are also 6 DRAFT duplicate games from an accidental double-run of the upload script. These are invisible to users (only PUBLISHED games appear in the store) but should be cleaned up via the dev portal.

### Accounts on VPS (DB wiped 2026-03-17, only real accounts exist)
- **Developer:** `eface` — uploaded all games via dev portal and scripts
- **Player:** `developer1` — purchased and downloaded PlayerCharacter01 Windows

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
13. **Vite `base` must match nginx path** — If a frontend is served under a subpath (e.g. `/dev/`), Vite's `base` in `vite.config.ts` must match (e.g. `base: "/dev/"`), otherwise asset URLs resolve to `/assets/...` instead of `/dev/assets/...` and you get a blank page.
14. **nginx `default_server`** — The boilerdeck site config uses `listen 80 default_server;` to override nginx's built-in welcome page. Without this, requests may hit the default nginx page instead.
15. **Multer temp dir** — The upload route auto-creates `/opt/boilerdeck/games/.tmp/` via `fs.mkdirSync(tmpDir, { recursive: true })` in the multer destination callback. Don't rely on it pre-existing.
16. **Upload pipeline proxy timeout** — nginx default `proxy_read_timeout` is 60s. Large uploads may need `proxy_read_timeout 1800;` in the `/api/` block if server-side processing (zip extraction + torrent creation) takes longer than 60s after upload completes.
17. **VPS deploy — Rollup Linux binding** — `package-lock.json` generated on Windows won't include `@rollup/rollup-linux-x64-gnu`. After `npm install` on VPS, may need `npm install @rollup/rollup-linux-x64-gnu` explicitly, or do a clean `rm -rf node_modules && npm install` on the VPS.
18. **VPS deploy — Prisma client regeneration** — After wiping `node_modules` on VPS, must run `npx prisma generate` before starting the server, otherwise Prisma client will be missing.
19. **Stripe Connect onboard tokens** — The return/refresh URLs for Stripe Connect use Redis-backed one-time-use tokens (`crypto.randomBytes(32)`, stored as `stripe_onboard:{token}` with 1-hour TTL). Tokens are consumed on use (deleted from Redis). Never pass raw Stripe account IDs in query params.
20. **Stripe webhook idempotency** — All webhook handlers (`handleCheckoutCompleted`, `handleCheckoutExpired`, `handleAccountUpdated`) check current state before mutating. `handleCheckoutExpired` won't overwrite a COMPLETED payment. `handleCheckoutCompleted` won't create duplicate licenses.
21. **CORS `origin: "null"` from Electron** — Electron `file://` sends `Origin: null` as a literal string, not absent. The CORS callback in `server/src/index.ts` handles three cases: `!origin` (no header, e.g. curl), `origin === "null"` (Electron file://), and origins in the allow list. Rejected origins get `callback(null, false)` (silent rejection, no 500).
22. **WebTorrent must run in main process** — If you put WebTorrent in a hidden BrowserWindow (renderer), it can only use WebRTC — standard BitTorrent clients (Transmission, qBittorrent) can't connect. The main process uses Node.js TCP/UDP sockets, enabling real BitTorrent peering. This is the single most important Electron architecture decision.
23. **Download completion requires IPC event** — The renderer has no way to know when a torrent finishes unless the main process explicitly sends a `downloads:complete` event. Without this, `markInstalled()` never fires and games don't appear in the Library after downloading. The event carries `{ gameId, title, infoHash, downloadPath }`.
24. **`downloadMeta` Map is module-level, not in Zustand** — The metadata needed to register an installed game (slug, exePath, drmTier, version, coverImageUrl) is stored in a plain `Map<string, DownloadMeta>` outside the Zustand store in `downloadStore.ts`. This is intentional — it doesn't need to be reactive, and putting it in Zustand would cause unnecessary re-renders.
25. **`tsconfig.main.json` needs `composite: true`** — Because `tsconfig.json` references it. Without this, you get `TS6306: Referenced project must have setting "composite": true`.
26. **Electron client renderer types** — `window.boilerdeck` types are declared in two places: `client/src/main/preload.ts` (the runtime `declare global`) and `client/src/renderer/env.d.ts` (for the renderer's tsconfig). Both must stay in sync. The renderer file also needs `/// <reference types="vite/client" />` for `import.meta.env`.
27. **electron-builder workspace hoisting** — npm workspaces hoist `electron` to root `node_modules/`, but electron-builder expects it in `client/node_modules/`. Fix: `electronVersion` is pinned to `"35.7.5"` in `client/package.json` build config so electron-builder downloads its own copy. If you upgrade Electron, update both `devDependencies.electron` and `build.electronVersion`.
28. **electron-builder native module rebuild fails (Python 3.12)** — `node-gyp` v9.x uses `distutils.version.StrictVersion` which was removed in Python 3.12. `npmRebuild: false` in the build config skips this. Native modules (`bufferutil`, `utf-8-validate`, `utp-native`) use prebuilt binaries via `prebuild-install` so compilation is unnecessary.
29. **electron-builder winCodeSign symlink error** — The winCodeSign tool archive contains macOS symlinks that can't be created on Windows without Developer Mode or admin privileges. `signAndEditExecutable: false` in the win config skips the winCodeSign download entirely. Without a code signing certificate this is the correct setting. Side effect: the raw `BoilerDeck.exe` won't show the custom icon in Explorer (but the NSIS installer itself works fine).
30. **Electron icon must be 256x256+** — electron-builder rejects icons smaller than 256x256. The placeholder icon is at `client/resources/icon.ico` (256x256 BMP-in-ICO). Replace with real branding when available.
31. **Windows SmartScreen warning** — The installer is not code-signed, so Windows SmartScreen will show "Windows protected your PC." Users click "More info" → "Run anyway." This is expected until an EV code signing certificate is purchased.
32. **`release/` directory** — electron-builder outputs to `client/release/`. This is gitignored. Never commit build artifacts.
33. **Helmet CORP blocks Electron** — Default `helmet()` sets `Cross-Origin-Resource-Policy: same-origin`, which blocks API responses in Electron's `file://` origin even when CORS headers are correct. Fix: `helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } })` in `server/src/index.ts`. This is NOT a CORS issue — it's a separate header enforced by the browser/Electron renderer before the response body is handed to JS.
34. **Server error response shape** — The server returns `{ error: { code, message } }`, not `{ message }`. All API clients must check `body.error?.message || body.message || res.statusText` in that order. The `|| body.message` fallback exists for backward compatibility; prefer `body.error?.message` for new code.
35. **Licenses endpoint wraps array** — `GET /api/licenses` returns `{ licenses: [...] }`, not a bare array. Code consuming this endpoint must unwrap: `const licenses = data.licenses`. `Array.isArray()` guards are advisable before calling array methods.
36. **JWT stale after server-side role change** — When the server upgrades a user's role (e.g., `POST /developer/register`), the existing JWT still carries the old role claim. Subsequent requests guarded by `requireRole("DEVELOPER")` will return 403. Fix: call `refreshAccessToken()` immediately after any role-changing operation on the client.
37. **React StrictMode double-fires effects** — In development, React 18+ runs effects twice. Any effect that makes a mutating API call (e.g., token rotation using `delete` by ID) will race and crash on the second call if the first already consumed the resource. Fix: use `deleteMany` instead of `delete` for idempotent operations, or guard with a ref flag.
38. **Transmission cleared, fresh torrents only** — As of 2026-03-17, Transmission was cleared of old test torrents. Only torrents added via the upload pipeline are present. If re-seeding manually, use the upload pipeline or `transmission-remote --add` with the .torrent file from the DB.
39. **Transmission doesn't persist torrents across restarts** — The manually-started `transmission-daemon` (PID-based, not systemd — systemd service times out) does NOT reliably persist added torrents. After any Transmission restart, torrents must be re-added. The upload pipeline's `addToTransmission()` is fire-and-forget (errors logged but non-fatal), so uploads succeed even if Transmission is down. **To re-add a torrent:** extract base64 from DB (`SELECT encode(torrent_file, 'base64') FROM torrents WHERE id = '...'`), then POST to Transmission RPC with `download-dir: /opt/boilerdeck/games` (NOT `/opt/boilerdeck/games/<slug>` — the torrent's internal root folder provides the slug directory). See re-seeding script below.
40. **WebTorrent download path — do NOT append game slug** — `wt.add(source, { path })` creates the torrent's internal root folder (named after the game slug) inside `path`. If you pass `installDir/slug` as path, you get `installDir/slug/slug/...` (double nesting). Pass `installDir` as the WebTorrent download path; the install path (for the game registry) is `installDir/slug`.
41. **WebTorrent must be destroyed after download completes** — `torrent.destroy({ destroyStore: false })` releases file handles without deleting downloaded files. Without this, the exe stays locked (EBUSY) and the game can't be launched. The client no longer seeds after download — acceptable for a game distribution client.
42. **Stale Electron processes on Windows** — Closing the Electron window doesn't always kill the main process (especially in dev mode). Multiple zombie Electron processes accumulate, each holding WebTorrent file locks. Before debugging EBUSY errors, run `tasklist //FI "IMAGENAME eq electron.exe"` and kill all instances with `taskkill //F //IM electron.exe`.
43. **Exe auto-detection is recursive** — `detectExecutable()` in `catalog/service.ts` walks subdirectories to find `.exe` files. Game uploads often nest files (e.g., `PeerPlayBuild/Game.exe`). The detected path is stored relative to the game's root directory (e.g., `PeerPlayBuild/Game.exe`), and the client joins it with the install path at launch time.
44. **Refresh token race condition (client-side)** — All API clients (client, web, dev-portal) use a `refreshPromise` lock to serialize concurrent refresh calls. Without this, two simultaneous 401 responses both trigger `refreshAccessToken()`, the second one sends the already-rotated token, gets 401, and **deletes the new token** stored by the first call — logging the user out. This is different from gotcha #37 (server-side `deleteMany`).
45. **Publish endpoint is PATCH, not POST** — `PATCH /developer/games/:id/publish` and `PATCH /developer/games/:id/unpublish`. Using POST returns 404 with an HTML error page ("Cannot POST ...").
46. **addToTransmission silently fails for large torrents** — The upload pipeline's `addToTransmission()` sends base64-encoded torrent data via curl. For large games (hundreds of MB), the base64 string can exceed bash's argument length limit (~2 MB). The upload succeeds (game + torrent in DB) but Transmission never receives the torrent. **Always run `scripts/reseed-torrents.sh` after uploading games.** The reseed script works around this by writing base64 to a temp file and using `curl -d @file`.
47. **Games created in DRAFT status** — The `POST /developer/games` endpoint creates games with status `DRAFT`. They must be explicitly published via `PATCH /developer/games/:id/publish` to appear in the store listing. The `upload-games.mjs` script handles this automatically.
48. **Updater IPC events must use ref guard** — The Settings page update UI subscribes to 5 IPC events (`update-available`, `update-not-available`, `update-progress`, `update-downloaded`, `update-error`). React StrictMode double-fires effects, which would register duplicate listeners. The `listenersAttached` ref flag prevents this. Cleanup calls `removeUpdateListeners()` which removes all 5 at once.

---

## Electron Build & Release Pipeline

### Local Build
```bash
cd /c/Users/eface/peerplay/client
npm run build:electron          # Vite build (renderer) + tsc (main process)
../node_modules/.bin/electron-builder          # NSIS installer + portable exe → client/release/
../node_modules/.bin/electron-builder --dir    # Unpacked build only (fast, for testing)
```

**Output files** (in `client/release/`):
- `BoilerDeck Setup 0.1.0.exe` — NSIS installer (GUI wizard, directory picker)
- `BoilerDeck 0.1.0.exe` — Portable exe (no install needed)
- `latest.yml` — electron-updater auto-update manifest
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
- **Runs on:** `windows-latest`
- **Publishes:** `--publish onTagOrDraft` — only creates GitHub Release when triggered by a tag (not on manual dispatch)
- **Auth:** Uses built-in `GITHUB_TOKEN` (no custom secrets needed)

### Version Bumping
The version in `client/package.json` (`"version": "0.2.0"`) controls the installer filename and auto-update version comparison. The git tag should match (e.g., `v0.2.0`). Bump both together.

### Current Release
- **v0.2.0** — https://github.com/EthanGeisler/peerplay/releases/tag/v0.2.0
- Published 2026-03-17, built via CI (GitHub Actions on `v0.2.0` tag push)
- NSIS installer (90MB) + portable exe (89MB) + blockmap (delta updates)
- Not code-signed (SmartScreen warning expected)
- **v0.1.0** — https://github.com/EthanGeisler/peerplay/releases/tag/v0.1.0 (superseded, auto-update prompts users to v0.2.0)

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
- Both link to `/downloads/BoilerDeck%20Setup%200.2.0.exe` — served directly from VPS. nginx serves from `/opt/boilerdeck/downloads/` with `Content-Disposition: attachment`.

### Releasing a New Client Version (full process)
```bash
# 1. Bump version in client/package.json (e.g., 0.2.0 → 0.3.0)
# 2. Update download links in web/src/App.tsx and web/src/pages/Store.tsx
# 3. Commit + push + tag
git add client/package.json web/src/App.tsx web/src/pages/Store.tsx
git commit -m "Bump client version to 0.3.0 and update download links"
git push origin main
git tag v0.3.0 && git push origin v0.3.0
# 4. CI builds and publishes to GitHub Releases (~5-10 min)
gh run list --limit 1   # monitor progress
# 5. Download installer from GitHub Release
gh release download v0.3.0 -p "BoilerDeck-Setup-0.3.0.exe" -D /tmp
# 6. Upload to VPS (NOTE: GitHub uses hyphens, VPS needs spaces to match URL-encoded links)
scp /tmp/BoilerDeck-Setup-0.3.0.exe "root@204.168.133.38:/opt/boilerdeck/downloads/BoilerDeck Setup 0.3.0.exe"
# 7. Deploy updated web storefront
ssh root@204.168.133.38 "cd /opt/boilerdeck && git pull origin main && npx vite build web"
```
**Gotcha:** GitHub Release assets use hyphens (`BoilerDeck-Setup-0.2.0.exe`) but the VPS download links use spaces (`BoilerDeck%20Setup%200.2.0.exe`). Must rename when SCP-ing to VPS.
**Gotcha:** The `/opt/boilerdeck/downloads/` directory may not exist after VPS rebuild — create with `mkdir -p` before SCP.

---

## Git State

- **Repo:** https://github.com/EthanGeisler/peerplay (rename pending — GitHub repo still named `peerplay`)
- **Branch:** `main` (only branch)
- **40 commits** as of 2026-03-17 (latest first):
  1. `440a016` `Fix review issues: token race condition, error handling, DRM badges`
  2. `b063233` `Fix cover images in Electron client and add store link to dev portal setup`
  3. `6082929` `Fix cover image upload field name mismatch`
  4. `f8346ca` `Update docs with v0.2.0 release, auto-update details, and release process`
  5. `912f091` `Bump client version to 0.2.0 and update download links`
  6. `bb26191` `Update CONTEXT.md and CLAUDE.md with session learnings`
  7. `8039e85` `Fix download path double-nesting and post-download file locking`
  8. `3ac80b2` `Fix token refresh race condition and upload pipeline issues`
  9+ (earlier commits omitted — see `git log` for full history)
- **Git identity:** `EthanGeisler` / `25466222+EthanGeisler@users.noreply.github.com`
- **Tags:** `v0.1.0` (first release), `v0.2.0` (current release — auto-update, bug fixes)

> **Important:** Commits 1–3 above are AFTER the v0.2.0 tag. The v0.2.0 release does NOT include cover image fixes or the Settings page update UI. A v0.2.1 release is needed to ship these to users via auto-update. The user has a local build with these fixes (built via `npm run build:electron && electron-builder` on 2026-03-17) but it's still versioned as 0.2.0.

---

## What's Next (Not Yet Built)

Refer to the plan in `.claude/plans/twinkling-hugging-thunder.md` for the full roadmap. Key next steps:

### Short-term
- [x] Connect web storefront to real API (replace mock data with fetch calls) — done 2026-03-16
- [x] Stripe Connect integration (real payments via Stripe Checkout + Connect destination charges) — done 2026-03-16
- [x] Electron client — full build: store browsing, purchase, BitTorrent downloads, DRM enforcement (LIGHT verify + ENCRYPTED decrypt), game launch, install management, settings
- [x] DRM Tier 1 (LIGHT) — server + client: device fingerprinting, max 3 devices, verify before launch
- [x] DRM Tier 2 (ENCRYPTED) — server + client: crypto utils, key delivery, decrypt after download
- [x] DRM storefront UI — DRM badges on game cards, DRM info card on detail page, 3-column comparison on About page
- [x] Developer portal SPA (`dev-portal/`) — manage games, file upload pipeline, version management
- [x] Consolidated hosting — storefront + dev portal + API all on VPS
- [x] Electron build pipeline — NSIS installer + portable exe, GitHub Actions CI, v0.1.0 published
- [x] Download button on web storefront — header button + Store page banner, now served directly from VPS `/downloads/`
- [x] Open-source game library — 6 free GPL games uploaded, cover images added, seeding on VPS (2026-03-17)
- [x] Settings page manual update UI — check for updates button, progress bar, restart button (2026-03-17, in local build, needs v0.2.1 release)
- [ ] Cut v0.2.1 release — includes cover image fixes, Settings update UI, and other post-v0.2.0 fixes. Bump version, tag, CI build, SCP to VPS.
- [ ] Clean up 6 DRAFT duplicate games from accidental double-upload (delete via dev portal)
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
- [ ] Search / categories / reviews
- [ ] Private opentracker instance + seed boxes
- [ ] Code signing certificate for Windows installer (removes SmartScreen warning)

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
| Build workflow (Electron) | `.github/workflows/build-client.yml` |
| Electron build config | `client/package.json` (`"build"` field) |
| Electron app icon | `client/resources/icon.ico` (placeholder — replace with real branding) |
| GitHub Release (current) | https://github.com/EthanGeisler/peerplay/releases/tag/v0.2.0 |
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
