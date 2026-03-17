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
- **Native deps** (like `utp-native` for WebTorrent): must be in `asarUnpack` in electron-builder config

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
**Nginx downloads block:** The `/downloads/` location in `/etc/nginx/sites-available/boilerdeck` serves from `/opt/boilerdeck/downloads/` with `Content-Disposition: attachment`. When releasing a new installer version, scp the file to that directory and update the link in `web/src/App.tsx` and `web/src/pages/Store.tsx`.

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

## Environment
- Copy `server/.env.example` to `server/.env` and configure
- Requires PostgreSQL and Redis running locally (or connection strings to remote instances)
