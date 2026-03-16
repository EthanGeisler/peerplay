# Peerplay — Decentralized Game Distribution Platform

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
- **Client:** `npm run dev:client` from root (Vite dev server)
- **Dev Portal:** `npm run dev:portal` from root (Vite on port 5174, proxies /api to localhost:3001)
- **Web Storefront:** `npm run dev:web` from root (Vite on port 5173, proxies /api to localhost:3001)
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

## Agents (`.claude/agents/`)

| Agent | Trigger | What it does |
|-------|---------|-------------|
| `feature-coordinator` | `@feature-coordinator {description}` | Produces a cross-cutting implementation plan identifying every file/layer that needs changes, in dependency order |
| `deploy` | `@deploy` | Handles full deploy to VPS — pre-flight checks, pull, build, restart, health verification |
| `server-reviewer` | `@server-reviewer` | Reviews recent server code changes for convention compliance, security, and Peerplay-specific gotchas |
| `frontend-reviewer` | `@frontend-reviewer` | Reviews recent frontend changes across web, dev-portal, and client for correctness and patterns |

### Recommended Workflow

1. **Plan:** `@feature-coordinator {what to build}` — get a cross-cutting implementation plan before writing code
2. **Build:** Implement the feature (main conversation)
3. **Review:** `@server-reviewer` and/or `@frontend-reviewer` — catch issues before committing
4. **Ship:** Commit, push, then `@deploy` to get changes live on the VPS

### Design Philosophy
- **Feature coordinator plans, main conversation builds.** Most Peerplay features cut across layers (schema → server → frontend → infra). The coordinator identifies all touchpoints; the main conversation does the actual implementation because cross-cutting changes need tight coordination, not isolated subagents.
- **Reviewers catch, not block.** Run reviewers after writing code to catch convention drift and gotchas. They review only changed files.
- **Deploy agent automates the manual SSH flow.** It figures out what changed, only rebuilds what's needed, and verifies health after.

## Environment
- Copy `server/.env.example` to `server/.env` and configure
- Requires PostgreSQL and Redis running locally (or connection strings to remote instances)
