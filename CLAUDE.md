# BoilerDeck — Decentralized Game Distribution Platform

> **Start here:** Read `CONTEXT.md` for full project state, what's been built, known issues, and next steps.

## Project Structure
- `server/` — Node.js + TypeScript backend monorepo (Express, Prisma, PostgreSQL)
- `server/packages/` — Modular service packages (auth, catalog, license, payment, saves, torrent, shared)
- `server/prisma/` — Database schema and migrations
- `client/` — Electron + React desktop app (Vite, zustand, WebTorrent)
- `dev-portal/` — Developer dashboard SPA (Vite, React 19, Zustand, real API calls)
- `web/` — Public storefront SPA (Vite, React 19, HashRouter, real API calls)
- `docs/` — Public documentation (future)

## Development
- **Server:** `npm run dev:server` from root (uses tsx watch)
- **Client (Electron):** `npm run dev:client` from root (starts both Vite dev server on port 5173 and Electron main process)
- **Client build:** `cd client && npm run build:electron` (Vite + tsc), then `../node_modules/.bin/electron-builder` (NSIS + portable → `client/release/`). Do NOT use `npx electron-builder` (resolves wrong version). See CONTEXT.md "Electron Build & Release Pipeline" for full details.
- **Client release:** `gh release create v0.x.x <files>` or push a `v*` tag to trigger CI (`.github/workflows/build-client.yml`)
- **Dev Portal:** `npm run dev:portal` from root (Vite on port 5174, proxies /api to localhost:3001)
- **Web Storefront:** `npm run dev:web` from root (Vite on port 5173, proxies /api to localhost:3001)
- **Database:** `npm run db:migrate` (Prisma migrate), `npm run db:seed` (seed data)
- All packages use ESM (`"type": "module"`) — use `.js` extensions in imports

## Key Conventions
- Express routes use `try/catch` with `next(err)` pattern
- Input validation via Zod schemas
- Auth via JWT (access + refresh tokens), `authenticate` middleware from `@boilerdeck/shared`
- Role checks via `requireRole("DEVELOPER")` etc.
- Error classes: AppError, NotFoundError, UnauthorizedError, ForbiddenError, ConflictError, ValidationError
- Stripe: import `getStripe` from `@boilerdeck/shared` (singleton in `shared/src/stripe.ts`) — never instantiate Stripe directly in packages
- Prisma models are PascalCase, DB tables are snake_case (via `@@map`)
- **Server error shape:** Server returns `{ error: { code, message } }`. All API clients parse errors as `body.error?.message || body.message || res.statusText`. Never assume `body.message` at the top level.
- **Helmet CORP:** Always initialize Helmet with `crossOriginResourcePolicy: { policy: "cross-origin" }` in `server/src/index.ts`. The default `same-origin` breaks Electron's `file://` renderer even when CORS is configured correctly.
- **Token rotation must be idempotent:** Use `deleteMany` instead of `delete` when rotating refresh tokens — React StrictMode double-fires effects and concurrent requests will both find the same token. `deleteMany` on an already-deleted token is a no-op; `delete` throws Prisma P2025.
- **Refresh calls must be serialized:** All API clients use a `refreshPromise` lock in `api.ts` so only one `refreshAccessToken()` runs at a time. Concurrent callers await the same promise. Without this, concurrent 401s cause a race that invalidates the session.
- **Role changes require token refresh:** Any endpoint that upgrades a user's role must be followed by `refreshAccessToken()` on the client. The existing JWT carries the old role claim until refreshed.
- **`GET /api/licenses` returns `{ licenses: [...] }`** — not a bare array. Always unwrap `data.licenses` and add `Array.isArray()` guard before calling array methods.

## Electron Client Conventions
- **IPC handlers** go in `client/src/main/index.ts` `setupIpcHandlers()` — namespaced like `store:get`, `downloads:start`, `drm:get-fingerprint`
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
      "description": "...", "version": "1.0.0", "priceCents": 0, "drmTier": "NONE" }]
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
