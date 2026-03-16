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
| `license` | License listing, verification with device fingerprinting (max 3 devices), decryption key delivery for ENCRYPTED tier, device deregistration. Crypto utils for AES-256-GCM key wrap/unwrap and HKDF per-user key derivation. | `src/service.ts`, `src/routes.ts`, `src/crypto.ts` |
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
- `GET /api/licenses`, `POST /api/licenses/:gameId/verify` (with device fingerprinting)
- `POST /api/licenses/:gameId/key` (ENCRYPTED DRM — decryption key delivery)
- `DELETE /api/licenses/:gameId/devices/:fingerprint` (device deregistration)
- `POST /api/payments/checkout`, `POST /api/payments/webhook`
- `GET /api/torrents/:gameId/latest` (includes `encrypted` flag + `algorithm` for encrypted games)
- `GET /api/health`

### Web Storefront — Vite + React 19 (`web/`)

Static SPA deployed to GitHub Pages. Uses **HashRouter** (not BrowserRouter) because GH Pages has no server-side routing.

**Pages** (`web/src/pages/`):
- `Store.tsx` — Featured hero (Player Character 01) + game grid cards with DRM tier badges (green "DRM-Free", amber "Online Check", blue "Encrypted")
- `GameDetail.tsx` — Full detail page with edition picker (for games with multiple editions), dynamic DRM info card, purchase button, magnet download link, revenue split breakdown, tags
- `Library.tsx` — Owned games with Play button
- `About.tsx` — Platform explainer (revenue split, BitTorrent, 3-column DRM tier comparison cards with player/developer perspectives, tech stack)

**State:** Zustand store (`web/src/stores/appStore.ts`) — mock auth, purchase/library/cart logic, all client-side (no API calls from the web storefront).

**Data:** `web/src/data/mock.ts` — 7 games including Player Character 01 (featured, free, with real magnet URI). PC01 has an `editions` array (Free Edition DRM-Free / Premium Edition $9.99 LIGHT DRM). The mock data is separate from the DB seed data — they exist independently.

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
| **Nginx** | Reverse proxy on port 80, forwards `/api/` to Node on 3001 |
| **Peerplay API** | systemd service `peerplay`, Node/tsx on port 3001 |
| **PostgreSQL 16** | User: `peerplay`, DB: `peerplay`, localhost:5432 |
| **Redis 7** | localhost:6379 |
| **Transmission** | BitTorrent seeder on port 6881, seeding PC01 |

**SSH access:** `ssh root@204.168.133.38` (key: `~/.ssh/id_ed25519` on dev machine)

**Project location on VPS:** `/opt/peerplay/`
**Game files on VPS:** `/opt/peerplay/games/player-character-01/`
**Torrent file on VPS:** `/opt/peerplay/games/pc01.torrent`

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
- **Featured** on the web storefront with `featured: true` flag
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
- The hash in `web/src/data/mock.ts` and the DB `Torrent` record need to be updated to match the active VPS hash (`bf69c35...`).

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
10. **Web storefront is mock-only** — The GitHub Pages site uses hardcoded mock data in `web/src/data/mock.ts`, not the real API. The Electron client is the one that talks to the API.

---

## Git State

- **Repo:** https://github.com/EthanGeisler/peerplay
- **Branch:** `main` (only branch)
- **6 commits** as of 2026-03-16:
  1. `Initial commit: Peerplay MVP` — full monorepo with server, client, web, scripts
  2. `Add Player Character 01 as first game on the platform` — mock data, publish script, torrent file
  3. `Update Player Character 01 magnet URI to match active WebTorrent seeder` — fixed info hash mismatch
  4. `Add CONTEXT.md for session continuity between Claude instances`
  5. `Implement LIGHT and ENCRYPTED DRM tiers across server and storefront` — device fingerprinting, key delivery, crypto utils, edition picker, DRM badges, About page overhaul, encryption scripts
  6. `Deploy to Hetzner VPS with Transmission seeder` — VPS setup, standard BitTorrent seeding, CONTEXT.md updates
- **Git identity:** `EthanGeisler` / `25466222+EthanGeisler@users.noreply.github.com`

---

## What's Next (Not Yet Built)

Refer to the plan in `.claude/plans/twinkling-hugging-thunder.md` for the full roadmap. Key next steps:

### Short-term
- [ ] Connect web storefront to real API (replace mock data with fetch calls)
- [ ] Stripe Connect integration (real payments, currently mocked)
- [ ] Finish Electron client (WebTorrent download in hidden renderer, game launch, progress tracking)
- [x] DRM Tier 1 (LIGHT) — server: device fingerprinting in verifyLicense, max 3 devices, device deregistration endpoint
- [x] DRM Tier 2 (ENCRYPTED) — server: crypto utils (AES-256-GCM wrap/unwrap, HKDF derivation), key delivery endpoint, encryption metadata in torrent responses, encrypt-game + publish-game-encrypted scripts
- [x] DRM storefront UI — edition picker on PC01 (Free/Premium), DRM badges on game cards, DRM info card on detail page, 3-column comparison on About page
- [ ] Developer portal SPA (`dev-portal/`) — manage games, view sales
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
| Live site | https://ethangeisler.github.io/peerplay/ |
| Production API | http://204.168.133.38/api/health |
| Local API | http://localhost:3001/api/health |
| VPS SSH | `ssh root@204.168.133.38` |
| Prisma schema | `server/prisma/schema.prisma` |
| Server env (local) | `server/.env` |
| Server env (VPS) | `/opt/peerplay/server/.env` |
| Mock game data | `web/src/data/mock.ts` |
| Deploy workflow | `.github/workflows/deploy.yml` |
| Full architecture plan | `.claude/plans/twinkling-hugging-thunder.md` |
| Game build (PC01) | `C:\Users\eface\player-character-01\build\PeerPlayBuild\` |
| Game files (VPS) | `/opt/peerplay/games/player-character-01/` |
| Torrent file (VPS) | `/opt/peerplay/games/pc01.torrent` |
| Torrent scripts | `scripts/` |
| Transmission config | `/root/.config/transmission-daemon/settings.json` (on VPS) |
