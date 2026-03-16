# Peerplay — Decentralized Game Distribution Platform

> **Start here:** Read `CONTEXT.md` for full project state, what's been built, known issues, and next steps.

## Project Structure
- `server/` — Node.js + TypeScript backend monorepo (Express, Prisma, PostgreSQL)
- `server/packages/` — Modular service packages (auth, catalog, license, payment, saves, torrent, shared)
- `server/prisma/` — Database schema and migrations
- `client/` — Electron + React desktop app (Vite, zustand, WebTorrent)
- `dev-portal/` — Developer dashboard SPA (Vite, React 19, Zustand, real API calls)
- `web/` — Public storefront SPA (Vite, React 19, HashRouter, mock data)
- `docs/` — Public documentation (future)

## Development
- **Server:** `npm run dev:server` from root (uses tsx watch)
- **Client:** `npm run dev:client` from root (Vite dev server)
- **Dev Portal:** `npm run dev:portal` from root (Vite on port 5174, proxies /api to localhost:3001)
- **Web Storefront:** `npm run dev:web` from root (Vite on port 5173)
- **Database:** `npm run db:migrate` (Prisma migrate), `npm run db:seed` (seed data)
- All packages use ESM (`"type": "module"`) — use `.js` extensions in imports

## Key Conventions
- Express routes use `try/catch` with `next(err)` pattern
- Input validation via Zod schemas
- Auth via JWT (access + refresh tokens), `authenticate` middleware from `@peerplay/shared`
- Role checks via `requireRole("DEVELOPER")` etc.
- Error classes: AppError, NotFoundError, UnauthorizedError, ForbiddenError, ConflictError, ValidationError
- Prisma models are PascalCase, DB tables are snake_case (via `@@map`)

## Deployment to VPS
Everything runs on a single Hetzner VPS at `204.168.133.38`. Deploy process:
```bash
# 1. Commit and push locally
git add <files> && git commit -m "message" && git push origin main

# 2. SSH pull + install + rebuild
ssh root@204.168.133.38 "cd /opt/peerplay && git pull origin main && npm install"

# 3. Rebuild frontends (only if changed)
ssh root@204.168.133.38 "cd /opt/peerplay && npx vite build web"         # storefront
ssh root@204.168.133.38 "cd /opt/peerplay && npx vite build dev-portal"  # dev portal

# 4. Restart server (only if backend changed)
ssh root@204.168.133.38 "systemctl restart peerplay"
```
**Gotcha:** If VPS has local changes, `git pull` will fail — use `git stash --include-untracked` first.

## Environment
- Copy `server/.env.example` to `server/.env` and configure
- Requires PostgreSQL and Redis running locally (or connection strings to remote instances)
