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

**Live site:** https://ethangeisler.github.io/peerplay/ (GitHub Pages, auto-deploys on push to main)

---

## What Has Been Built (MVP v0.1)

### Server — Express + TypeScript monorepo (`server/`)

Fully functional REST API running on port **3001** (port 3000 is used by open-webui Docker container on this machine).

**Packages** (`server/packages/`):
| Package | What it does | Key files |
|---------|-------------|-----------|
| `shared` | Prisma client, middleware (auth, role check, error handler), config (Zod-validated env), Redis client, error classes | `src/db.ts`, `src/middleware.ts`, `src/config.ts`, `src/errors.ts`, `src/redis.ts` |
| `auth` | JWT auth (access 15m + refresh 7d with rotation), bcrypt password hashing, user registration/login | `src/service.ts`, `src/routes.ts`, `src/developer.routes.ts` |
| `catalog` | Game CRUD, slug generation, paginated listing, game detail with latest version | `src/service.ts`, `src/routes.ts` |
| `license` | License listing and verification (DRM check at launch) | `src/service.ts`, `src/routes.ts` |
| `payment` | Mock checkout flow — atomic `$transaction` creates Payment + License together, 1% platform fee calc | `src/service.ts`, `src/routes.ts` |
| `torrent` | Torrent retrieval with license ownership check | `src/service.ts`, `src/routes.ts` |
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

**Player Character 01** was also published to the DB via `scripts/publish-game.mjs`:
- Game slug in DB: `player-character-01-43dc` (the hex suffix is random, will differ after re-seed)
- Has a GameVersion (v0.1.0, 96MB) + Torrent record with magnet URI

**API endpoints (all verified working):**
- `POST /api/auth/register|login|refresh|logout`, `GET /api/auth/me`
- `GET /api/games`, `GET /api/games/:slug`
- `POST /api/developer/register`, `GET /api/developer/stripe/onboard`, `GET /api/developer/me`
- `POST /api/developer/games`, `PUT /api/developer/games/:id`
- `POST /api/developer/games/:id/versions`
- `GET /api/licenses`, `POST /api/licenses/:gameId/verify`
- `POST /api/payments/checkout`, `POST /api/payments/webhook`
- `GET /api/torrents/:gameId/latest`
- `GET /api/health`

### Web Storefront — Vite + React 19 (`web/`)

Static SPA deployed to GitHub Pages. Uses **HashRouter** (not BrowserRouter) because GH Pages has no server-side routing.

**Pages** (`web/src/pages/`):
- `Store.tsx` — Featured hero (Player Character 01) + game grid cards
- `GameDetail.tsx` — Full detail page with purchase button, magnet download link, revenue split breakdown, tags, DRM info
- `Library.tsx` — Owned games with Play button
- `About.tsx` — Platform explainer (revenue split, BitTorrent, DRM tiers, tech stack)

**State:** Zustand store (`web/src/stores/appStore.ts`) — mock auth, purchase/library/cart logic, all client-side (no API calls from the web storefront).

**Data:** `web/src/data/mock.ts` — 7 games including Player Character 01 (featured, free, with real magnet URI). The mock data is separate from the DB seed data — they exist independently.

**Deployment:** `.github/workflows/deploy.yml` — GitHub Actions builds and deploys to Pages on every push to main.

**Vite config:** `base: "/peerplay/"` for GitHub Pages subpath routing.

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
| `player-character-01.torrent` | Generated torrent file for PC01 (8KB) |
| `player-character-01.magnet.txt` | Magnet URI for quick reference |

---

## Infrastructure

**Local services (must be running for server to work):**
- **PostgreSQL 16** — Docker container `peerplay-postgres` on port 5432 (user: postgres, pass: postgres, db: peerplay)
- **Redis 7** — Docker container `peerplay-redis` on port 6379

**Start commands:**
```bash
# Start databases (if not already running)
docker start peerplay-postgres peerplay-redis

# Run migrations + seed (only needed on fresh setup or schema changes)
cd /c/Users/eface/peerplay && npm run db:migrate && npm run db:seed

# Start API server
npm run dev:server    # runs on port 3001

# Start web dev server (for local development, not needed if using GH Pages)
npm run dev:web       # runs on port 5173
```

**Environment:** `server/.env` — contains DATABASE_URL, REDIS_URL, JWT secrets, Stripe keys (mock), port config. Not committed to git.

---

## Player Character 01 — The First Real Game

- **Source:** `C:\Users\eface\player-character-01\build\PeerPlayBuild\`
- **Executable:** `PLAYER_CHARACTER_01PeerPlay.exe`
- **Size:** ~96MB
- **Magnet URI info hash:** `e82a3849a528a865692c72260e346dcc8071c86e` (from WebTorrent seeder)
- **Torrent file info hash:** `17f09e866c70ab18d4783395e540760b4c0e5fb9` (from create-torrent — different because WebTorrent and create-torrent produce different hashes from the same files)
- **Featured** on the web storefront with `featured: true` flag
- **DRM:** None (free, DRM-free)

**To seed the game (required for anyone to download via torrent):**
```bash
npx webtorrent seed "C:\Users\eface\player-character-01\build\PeerPlayBuild"
```
This must be running for the magnet link on the website to work. The seeder outputs the active magnet URI — if the info hash differs from what's in `web/src/data/mock.ts`, update the `magnetUri` field.

---

## Known Issues & Gotchas

1. **Port 3000 conflict** — `open-webui` Docker container uses port 3000. Peerplay API runs on 3001.
2. **BigInt serialization** — Prisma returns BigInt for large integer columns. The `toJSON` patch in `shared/src/db.ts` handles this, but if you see `TypeError: Do not know how to serialize a BigInt`, the server process may be stale (see #3).
3. **Stale server processes** — `pkill -f "tsx"` doesn't always kill the old process on Windows. Use `taskkill //F //PID <pid>` or check `netstat -ano | grep 3001` to find and kill the specific process.
4. **WebTorrent vs create-torrent info hashes** — These tools produce different torrent metadata from the same directory. Always use the info hash from the actively running seeder.
5. **Express 5 params** — `req.params.*` returns `string | string[]`. All route handlers wrap params with `String()`.
6. **JWT expiresIn typing** — Newer `@types/jsonwebtoken` expects `StringValue`. Cast with `as unknown as jwt.SignOptions["expiresIn"]`.
7. **ioredis ESM import** — Use `const RedisClient = IORedis.default ?? IORedis;` for ESM compatibility.
8. **Web storefront is mock-only** — The GitHub Pages site uses hardcoded mock data in `web/src/data/mock.ts`, not the real API. The Electron client is the one that talks to the API.

---

## Git State

- **Repo:** https://github.com/EthanGeisler/peerplay
- **Branch:** `main` (only branch)
- **3 commits** as of 2026-03-16:
  1. `Initial commit: Peerplay MVP` — full monorepo with server, client, web, scripts
  2. `Add Player Character 01 as first game on the platform` — mock data, publish script, torrent file
  3. `Update Player Character 01 magnet URI to match active WebTorrent seeder` — fixed info hash mismatch
- **Git identity:** `EthanGeisler` / `25466222+EthanGeisler@users.noreply.github.com`

---

## What's Next (Not Yet Built)

Refer to the plan in `.claude/plans/twinkling-hugging-thunder.md` for the full roadmap. Key next steps:

### Short-term
- [ ] Connect web storefront to real API (replace mock data with fetch calls)
- [ ] Stripe Connect integration (real payments, currently mocked)
- [ ] Finish Electron client (WebTorrent download in hidden renderer, game launch, progress tracking)
- [ ] DRM Tier 1 implementation (online license check at game launch)
- [ ] Developer portal SPA (`dev-portal/`) — manage games, view sales
- [ ] Real cover art / screenshots for Player Character 01 (currently using placehold.co)

### Medium-term
- [ ] DRM Tier 2 (AES-256-CTR encrypted torrents, per-user decryption keys)
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
| Live site | https://ethangeisler.github.io/peerplay/ |
| API health check | http://localhost:3001/api/health |
| Prisma schema | `server/prisma/schema.prisma` |
| Server env | `server/.env` |
| Mock game data | `web/src/data/mock.ts` |
| Deploy workflow | `.github/workflows/deploy.yml` |
| Full architecture plan | `.claude/plans/twinkling-hugging-thunder.md` |
| Game build (PC01) | `C:\Users\eface\player-character-01\build\PeerPlayBuild\` |
| Torrent scripts | `scripts/` |
