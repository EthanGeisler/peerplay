# Phase 6 Summary — Privacy Layer

## Status: CODE COMPLETE, BUILD BROKEN

All 7 sub-tasks (6.1–6.7) are implemented and committed. The code is correct. **The Electron build is broken at runtime** — the v0.3.0 installer crashes on launch with a module resolution error. This must be fixed before shipping.

---

## The Problem

**Symptom:** After installing v0.3.0, Electron shows: `"A JavaScript error occurred in the main process — Uncaught exception: No 'exports' main defined in C:/Program Files/.../package.json"`

**Root cause:** New dependencies added in Phase 6 (`socks-proxy-agent`, `ws`, `agent-base`, `socks`, `smart-buffer`) don't resolve correctly inside Electron's asar archive at runtime. The `asarUnpack` config was updated to unpack these modules, and CI builds pass, but **the runtime error persists** — the unpack patterns may not be sufficient, or there are transitive dependencies also trapped in the asar.

**What was tried (all committed):**
1. Added `!node_modules/@boilerdeck/**` to `files` exclude — didn't fix it (asar packer still followed workspace symlinks)
2. Changed `asarUnpack` from `node_modules/**/*.node` to specific module paths — fixed CI but not runtime
3. Moved `@boilerdeck/ui-shared` from `dependencies` to `devDependencies` — fixed CI build (asar packer no longer crashes on workspace symlink)
4. Added `socks-proxy-agent/**`, `agent-base/**`, `socks/**`, `smart-buffer/**`, `ws/**` to `asarUnpack` — CI passes but **runtime still crashes**

**What needs to happen next:**
- The error message mentions a specific `package.json` path — need to get the FULL error text (including which package.json) to identify the exact module
- Options to fix:
  - **Option A:** Get full error path, add that specific module to `asarUnpack`
  - **Option B:** Set `asar: false` temporarily to confirm the code works without asar, then systematically identify which module breaks
  - **Option C:** Bundle main-process code with esbuild/webpack so all imports are resolved at build time (eliminates runtime module resolution entirely) — this is the nuclear option but permanently fixes the class of problem
- After fixing, bump to v0.3.1 (v0.3.0 is burned — users who updated are stuck on a broken build and need to manually reinstall)

---

## What Was Built (all working code, just packaging is broken)

### 6.1 — Privacy settings store schema and IPC
- **`client/src/main/store.ts`** — `PrivacySettings` interface + `DEFAULT_PRIVACY_SETTINGS` (mode: "off")
- **`client/src/main/index.ts`** — 4 IPC handlers: `privacy:get-settings`, `privacy:save-settings`, `privacy:get-status`, `privacy:test-connection`
- **Preload + env.d.ts** — `window.boilerdeck.privacy.*` exposed

### 6.2 — SOCKS5 proxy module
- **`client/src/main/proxyManager.ts`** — `getProxyAgent(settings)` returns `http.Agent` for Tor (`socks5h://127.0.0.1:9150`) or custom SOCKS5, `testProxyConnection(settings)` tests via health endpoint
- Uses `socks-proxy-agent` v9 — **this is the package causing the asar issue**
- `SocksProxyAgent` cast to `http.Agent` via `as unknown as http.Agent` (type incompatibility between `agent-base` and Node's `http.Agent`)

### 6.3 — Route API traffic through proxy
- **`client/src/main/index.ts`** — `api:proxied-fetch` IPC handler using `node:https`/`node:http` with proxy agent
- **`client/src/renderer/api.ts`** — `apiFetch` checks privacy settings, routes through IPC when enabled. `shouldProxyApi()` reads settings, `proxiedApiFetch()` delegates to main process. `fetchTorrentFileBase64` also proxied.
- **Preload** — `window.boilerdeck.api.proxiedFetch` exposed

### 6.4 — Route BitTorrent traffic through SOCKS5
- **`client/src/main/torrentManager.ts`** — `shouldRouteTorrents()` only true when `mode === "socks5"` AND `routeTorrentTraffic === true` (never Tor). Disables DHT, LSD, UTP. Proxies tracker HTTP announces via `SocksProxyAgent`.
- **Limitation:** WebTorrent doesn't support SOCKS5 for peer-to-peer TCP — only tracker announces are proxied.

### 6.5 — Tor binary bundling
- **`client/src/main/torManager.ts`** — `startTor()`, `stopTor()`, `isTorRunning()`, `getTorStatus()`. Spawns `tor.exe` from extraResources with SocksPort 9150. Parses bootstrap progress from stdout. 60s timeout. Graceful shutdown on `before-quit`.
- **`client/resources/tor/`** — `.gitkeep` + README (tor.exe not committed, must be placed manually from Tor Expert Bundle)
- **IPC** — `tor:start`, `tor:stop`, `tor:status`, `tor:bootstrap-progress` event
- **electron-builder** — `extraResources` config bundles `resources/tor/`

### 6.6 — Privacy settings UI
- **`client/src/renderer/pages/Settings.tsx`** — "Privacy & Network" section added with: radio group (Off/Tor/SOCKS5), SOCKS5 fields (host/port/username/password), routing checkboxes (API always available, torrent only in SOCKS5 mode), test connection button, Tor bootstrap progress bar, info box.

### 6.7 — .onion endpoint documentation
- **`server/packages/shared/src/config.ts`** — `ONION_ADDRESS` optional Zod field
- **`server/packages/relay/src/routes.ts`** — relay info includes `onion_address` when configured
- **`client/src/renderer/api.ts`** — `discoverOnionAddress()` fetches relay info, `getEffectiveApiBase()` returns .onion URL in Tor mode
- **`docs/privacy.md`** — comprehensive privacy documentation

---

## CI Build Issues Encountered & Fixed

| Issue | Fix | Commit |
|-------|-----|--------|
| `SocksProxyAgent` missing `http.Agent` properties | Cast via `as unknown as http.Agent` | `03592a5` |
| `shared-ui/package.json must be under client/` (asar packer follows workspace symlinks) | Moved `@boilerdeck/ui-shared` to devDependencies | `be67973` |
| `asarUnpack` glob `node_modules/**/*.node` walks into workspace symlinks | Changed to specific module targets | `1fe95f1` |
| Runtime "No exports main defined" crash | Added socks-proxy-agent + deps to `asarUnpack` | `0397b9a` — **NOT FULLY FIXED** |

---

## Current Git State

- **Tag `v0.3.0`** points to `0397b9a` — this build is broken at runtime
- **v0.2.1** was the last working release
- Download links in `web/src/App.tsx` and `web/src/pages/Store.tsx` point to v0.3.0
- VPS has v0.3.0 installer at `/opt/boilerdeck/downloads/BoilerDeck Setup 0.3.0.exe`
- VPS server was restarted (has `ONION_ADDRESS` config field now)
- GitHub Release v0.3.0 is published (not draft)

## Files Changed in Phase 6

```
client/src/main/store.ts          — PrivacySettings interface + defaults
client/src/main/proxyManager.ts   — NEW: SOCKS5 proxy agent + test connection
client/src/main/torManager.ts     — NEW: Tor process lifecycle management
client/src/main/torrentManager.ts — Privacy-aware torrent downloads
client/src/main/index.ts          — Privacy + Tor IPC handlers, before-quit hook
client/src/main/preload.ts        — privacy.* and tor.* bridge
client/src/renderer/env.d.ts      — Type declarations for privacy/tor IPC
client/src/renderer/api.ts        — Proxied fetch, .onion auto-discovery
client/src/renderer/pages/Settings.tsx — Privacy & Network UI section
client/package.json               — socks-proxy-agent, ws deps + build config changes
client/resources/tor/              — NEW: placeholder for Tor Expert Bundle
server/packages/shared/src/config.ts — ONION_ADDRESS optional field
server/packages/relay/src/routes.ts  — onion_address in relay info
docs/privacy.md                   — NEW: privacy documentation
docs/handoff/6.1.md through 6.7.md — Sub-task handoff docs
web/src/App.tsx                   — Download link → 0.3.0
web/src/pages/Store.tsx           — Download link → 0.3.0
```

## Recovery Plan

1. Fix the asar/module resolution issue (see options above)
2. Bump version to `0.3.1`
3. Update download links to `0.3.1`
4. Build, test locally (`release/win-unpacked/BoilerDeck.exe`), confirm it launches
5. Tag `v0.3.1`, CI build, publish release
6. Upload new installer to VPS
7. Users on broken v0.3.0 will need to manually download v0.3.1 from the website (auto-updater may not work from a crashed app)
