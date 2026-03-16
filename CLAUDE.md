# Peerplay — Decentralized Game Distribution Platform

> **Start here:** Read `CONTEXT.md` for full project state, what's been built, known issues, and next steps.

## Project Structure
- `server/` — Node.js + TypeScript backend monorepo (Express, Prisma, PostgreSQL)
- `server/packages/` — Modular service packages (auth, catalog, license, payment, saves, torrent, shared)
- `server/prisma/` — Database schema and migrations
- `client/` — Electron + React desktop app (Vite, zustand, WebTorrent)
- `dev-portal/` — Developer dashboard SPA (Vite, React 19, Zustand, real API calls)
- `docs/` — Public documentation (future)

## Development
- **Server:** `npm run dev:server` from root (uses tsx watch)
- **Client:** `npm run dev:client` from root (Vite dev server)
- **Dev Portal:** `npm run dev:portal` from root (Vite on port 5174, proxies /api to localhost:3001)
- **Database:** `npm run db:migrate` (Prisma migrate), `npm run db:seed` (seed data)
- All packages use ESM (`"type": "module"`) — use `.js` extensions in imports

## Key Conventions
- Express routes use `try/catch` with `next(err)` pattern
- Input validation via Zod schemas
- Auth via JWT (access + refresh tokens), `authenticate` middleware from `@peerplay/shared`
- Role checks via `requireRole("DEVELOPER")` etc.
- Error classes: AppError, NotFoundError, UnauthorizedError, ForbiddenError, ConflictError, ValidationError
- Prisma models are PascalCase, DB tables are snake_case (via `@@map`)

## Environment
- Copy `server/.env.example` to `server/.env` and configure
- Requires PostgreSQL and Redis running locally (or connection strings to remote instances)
