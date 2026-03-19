# Phase 7 — Content Generalization (Complete)

Deployed 2026-03-19. Commit `e8284a3`. All 12 sub-tasks (7.1–7.12) in a single commit.

## What This Phase Did

Transformed BoilerDeck from a game-only marketplace into a multi-content marketplace supporting GAME, VIDEO, SOFTWARE, AUDIO, and OTHER content types.

## Key Architecture Decisions

### Naming: Prisma rename without SQL migration
- Prisma models renamed: `Game` → `Listing`, `GameVersion` → `ListingVersion`, `GameStatus` → `ListingStatus`
- `@@map("games")`, `@@map("game_versions")`, `@@map("GameStatus")` preserves all DB names
- FK fields stay as `gameId` with `@map("game_id")` — changing FK names would require a real migration and touch every query
- **Result:** Zero-downtime rename. One migration only for the new `content_type` column and `metadata` JSON field.

### Backwards compatibility everywhere
- Old `/api/games` routes kept alongside new `/api/listings` routes (identical behavior)
- Old function names (`listPublishedGames`, `createGame`, etc.) exported as aliases
- Old TypeScript types (`ApiGame`, `ApiGameDetail`) kept as type aliases
- Old event kind constants (30001, 30002) unchanged (protocol constants)

### Content type system
- `ContentType` enum: GAME (default), VIDEO, SOFTWARE, AUDIO, OTHER
- `metadata` JSON field: empty `{}` by default, for future type-specific data
- Content type is set at creation and **locked after** (changing type on existing listings could break assumptions from upload pipeline)
- Exe detection only runs for GAME and SOFTWARE
- Multer file filter is permissive (zip + mp4/webm/mkv/mp3/wav/ogg/flac) — validation happens post-upload based on contentType

## Files Changed (by sub-task)

### 7.1–7.2: Schema
- `server/prisma/schema.prisma` — ContentType enum, Listing/ListingVersion/ListingStatus models with @@map
- `server/prisma/migrations/20260319011415_add_content_type_and_metadata/migration.sql`

### 7.3–7.7: Server packages
- `server/packages/catalog/src/service.ts` — Renamed all functions, added contentType filter, aliases at bottom
- `server/packages/catalog/src/routes.ts` — Added `/listings` + `/developer/listings` route sets, contentType in Zod schemas, permissive multer
- `server/packages/catalog/src/upload.ts` — Conditional exe detection (`contentType === "GAME" || "SOFTWARE"`)
- `server/packages/license/src/service.ts` — `db.listing.*`, includes contentType in select
- `server/packages/payment/src/service.ts` — `db.listing.*`, error messages say "Listing"
- `server/packages/torrent/src/service.ts` — `createTorrent` (alias `createGameTorrent`), `db.listingVersion.*`
- `server/packages/relay/src/routes.ts` — `db.listing.*`, `/listings/:slug/reviews` redirect alias
- `server/packages/relay/src/service.ts` — `db.listing.updateMany`
- `server/packages/shared/src/eventMaterializer.ts` — `db.listing.*`, `db.listingVersion.*`
- `server/packages/auth/src/developer.routes.ts` — `listings:` include (was `games:`)
- `server/prisma/seed.ts` — `db.listing.upsert`

### 7.8–7.10: Client types, stores, detail pages, video playback
- `client/src/renderer/types.ts` — ContentType, contentType on ApiGame/InstalledGame/DevGameForm, ApiListing aliases
- `web/src/types.ts` — Same ContentType additions
- `dev-portal/src/types.ts` — contentType/metadata on GameForm, GameData, GameSummary
- `client/src/renderer/stores/gameStore.ts` — Fetches from `/listings`, accepts contentType filter
- `web/src/stores/gameStore.ts` — Same
- `client/src/renderer/pages/GameDetail.tsx` — Content type badge, conditional exe info, VideoPlayer integration
- `web/src/pages/GameDetail.tsx` — Content type badge
- `client/src/renderer/App.tsx` + `web/src/App.tsx` — Added `/listing/:slug` route
- **NEW** `client/src/main/mediaServer.ts` — Local HTTP server for streaming (Content-Range support)
- **NEW** `client/src/renderer/components/VideoPlayer.tsx` — HTML5 video element via IPC
- `client/src/main/index.ts` — IPC: `media:get-file-path`, `media:start-server`
- `client/src/main/preload.ts` + `client/src/renderer/env.d.ts` — `window.boilerdeck.media` bridge

### 7.11–7.12: UI generalization
- `client/src/renderer/pages/Store.tsx` + `web/src/pages/Store.tsx` — Content type filter tabs
- `dev-portal/src/pages/Dashboard.tsx` — "Creator Dashboard", "Your Listings", "Total Listings"
- `dev-portal/src/pages/GameEditor.tsx` — "New Listing"/"Edit Listing", "Create Listing & Upload", contentType in API body, ExeDetector conditional
- `dev-portal/src/components/GameEditorForm.tsx` — Content type selector pills, conditional Copy Protection
- `dev-portal/src/App.tsx` — Removed dead "Games" nav link
- `client/src/renderer/pages/developer/DevDashboard.tsx` — Same text updates as dev-portal
- `client/src/renderer/pages/developer/DevGameEditor.tsx` — Same editor changes
- `client/src/renderer/pages/developer/DevGameDetail.tsx` — "Listing Details", "Listing not found"
- `client/src/renderer/components/developer/GameEditorForm.tsx` — Content type selector, conditional Copy Protection
- `scripts/upload-games.mjs` — Uses `/developer/listings` routes, supports `contentType` in manifest

## Gotchas Encountered

1. **`Record<string, unknown>` vs `Prisma.InputJsonValue`** — Prisma's Json field type requires `Prisma.InputJsonValue`, not a plain Record. In Zod schemas, use `.transform((v) => v as Prisma.InputJsonValue)`.

2. **Transaction-scoped calls missed by find-replace** — Bulk replacing `db.game.` → `db.listing.` missed `tx.game.` and `tx.gameVersion.` inside Prisma transactions (upload.ts). Always grep for both `db.game` and `tx.game`.

3. **EPERM on Windows during `prisma generate`** — `query_engine-windows.dll.node` locked by running node processes. Fix: `rm -f` the locked file, or kill node processes first.

4. **Dev-portal dead nav link** — The "Games" nav item pointed to `/games` which had no route (only `/games/new`, `/games/:id`, `/games/:id/edit`). The catch-all `*` redirected to `/`, making clicks appear to do nothing. Removed the nav item.

5. **`router.handle` not on Express Router type** — When trying to forward routes internally, `router.handle()` causes TS2339. Use HTTP 307 redirects instead for alias routes.

## What's Next

Phase 8 is the final phase: Bitcoin Lightning payments, full Nostr interop, and any remaining decentralization work. See `DECENTRALIZATION_PLAN.md`.
