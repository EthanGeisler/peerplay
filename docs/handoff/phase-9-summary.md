# Phase 9 Summary — Data Locker

## Overview

The Data Locker is a personal encrypted file vault built into BoilerDeck. Users upload files from any device, metadata is NIP-44 encrypted and published as Nostr events (kind 30078), and files are distributed via BitTorrent with the VPS acting as a persistent seed. Files remain available even when all user devices are offline.

## Architecture

```
Device A: file -> torrent -> encrypt metadata -> publish to relay
                                                     |
Relay:                              encrypted NIP-44 event (kind 30078)
                                                     |
Device B:               subscribe -> decrypt -> join swarm -> download
                                                     ^
VPS:                              persistent seed (always available)
```

### Key Design Decisions

- **NIP-78 (kind 30078)** for application-specific data — avoids collision with other Nostr event types
- **Parameterized replaceable** events (NIP-33 via d-tag) — updating a file replaces the old event
- **NIP-44 encryption** (XChaCha20-Poly1305) — metadata is invisible to relay operators and the server (for self-custody users)
- **Dual custody model** — custodial users trust the server; self-custody users manage their own keys
- **SHA-256 content deduplication** — identical files share a single torrent, saving VPS storage
- **Soft delete with retention** — deleted files kept for 30 days (configurable) for recovery

## Sub-Phase Summary

### 9.1 — Locker Event Schema & Types
Defined `LockerEntry` interface and `LOCKER_ENTRY_KIND = 30078` constant. Created validation, serialization, and event tag helpers in `server/packages/shared/src/locker.ts`. Unit tests for schema validation.

### 9.2 — NIP-44 Encryption Module
Implemented NIP-44 v2 encryption/decryption in `server/packages/auth/src/nip44.ts` (server-side) and `client/src/main/nip44.ts` (client-side). Conversation key derivation via ECDH + HKDF-SHA256. Self-encryption and cross-user encryption support. Test vectors from NIP-44 spec.

### 9.3 — Server Locker API
Created `server/packages/locker/` package with Express routes for upload, list, delete, torrent retrieval. Multipart file upload via multer. SHA-256 computation, torrent creation, Transmission RPC seeding, NIP-44 encryption, Nostr event signing and publishing.

### 9.4 — Prisma Schema & Storage Tracking
Added `LockerFile` and `LockerQuota` models. BigInt for file sizes. DB-based quota tracking with increment/decrement. Soft delete pattern with `deletedAt` timestamp. Migration applied.

### 9.5 — Client Upload (Electron)
Created `client/src/main/lockerManager.ts` with dual upload paths: custodial (via server API) and self-custody (local torrent creation + event signing + relay publish). Native file dialog integration. Upload progress via IPC. Self-custody users bypass server for metadata — only raw file bytes sent for VPS seeding.

### 9.6 — Client Download & Sync
Relay subscription for locker events. Local locker index (JSON file). Download via WebTorrent with SHA-256 verification. Background sync on startup and every 5 minutes. Auto-download option. Configurable download location.

### 9.7 — Locker UI (Desktop)
Full desktop UI: file browser (grid/list toggle), drag-and-drop upload, search/filter by filename and tags, sort by name/size/date, quota usage bar, file type icons, status badges (Cloud/Downloading/Local/Seeding/Error), context menu, encryption indicators. Zustand store mirrors existing patterns.

### 9.8 — Web Locker View
Read-only web storefront page. Login-gated. Lists entries, shows metadata, magnet link copy, download deep link to desktop client. Banner for "Install BoilerDeck Desktop to upload files."

### 9.9 — Sharing
Share entries with other users via NIP-44 re-encryption to recipient's pubkey. Share events have `p`-tag (recipient), `shared-from` (sender), `shared-entry` (original). Recipient subscription via `#p` filter. Revocable via NIP-09 delete. Rate limited (100/hour). Desktop and web share dialogs.

### 9.10 — VPS Seed Management
Seed manager queries Transmission RPC for locker torrent stats. Pauses torrents for soft-deleted entries. Removes expired torrents after retention period. Storage stats endpoint. Cleanup cron job (6-hour interval).

### 9.11 — E2E Encryption Verification
Full security audit of custodial and self-custody paths. Pure cryptographic test suite (encryption.test.ts). Security documentation (docs/locker-security.md). Encryption indicators in UI (badges with tooltips). Documented cleartext t-tag trade-off.

### 9.12 — Offline & Resilience
Persistent offline upload queue with exponential backoff. Local-first entry loading (cache + sync). Multi-relay publish and failover. Connection status tracking. Graceful degradation UI banners. Data export feature.

### 9.13 — Testing, Polish & Documentation
Integration tests (upload/list/delete/quota/dedup/share flows). LockerEntry validation tests. Quota math tests. Keyboard shortcuts (Ctrl+U upload, Delete remove, Enter open/download, Ctrl+A select all, Escape clear). Multi-select (click/Shift+click/Ctrl+click). Batch operations (Download All, Delete All with confirmation). Documentation updates (CONTEXT.md, VERIFICATION_CHECKS.md, CLAUDE.md, DATA_LOCKER_PLAN.md).

## Key Files

| File | Purpose |
|------|---------|
| `server/packages/shared/src/locker.ts` | LockerEntry type, validation, serialization |
| `server/packages/locker/src/service.ts` | Core business logic (upload, list, delete, share) |
| `server/packages/locker/src/routes.ts` | Express REST endpoints |
| `server/packages/locker/src/storage.ts` | File storage, quota management |
| `server/packages/locker/src/dedup.ts` | SHA-256 content deduplication |
| `server/packages/locker/src/seedManager.ts` | Transmission RPC management |
| `server/packages/locker/src/config.ts` | Environment config |
| `server/packages/auth/src/nip44.ts` | Server-side NIP-44 encryption |
| `client/src/main/nip44.ts` | Client-side NIP-44 encryption |
| `client/src/main/lockerManager.ts` | Electron locker manager |
| `client/src/main/lockerStore.ts` | Local locker index |
| `client/src/main/lockerSettings.ts` | Client-side locker settings |
| `client/src/main/lockerUploadQueue.ts` | Offline upload queue |
| `client/src/renderer/stores/lockerStore.ts` | Zustand UI store |
| `client/src/renderer/pages/LockerPage.tsx` | Desktop locker page |
| `web/src/pages/LockerPage.tsx` | Web locker page (read-only) |
| `docs/locker-security.md` | Security model documentation |
| `scripts/locker-cleanup-cron.ts` | VPS cleanup cron job |

## Known Limitations

1. **File content is not encrypted** — VPS seeds raw bytes via BitTorrent. Only metadata (filenames, tags, MIME types) is encrypted. True file content encryption would prevent server-side deduplication and require client-side decryption after download.

2. **Cleartext t-tags** — User-defined tags appear as cleartext `["t", tag]` on Nostr events for relay-side filtering. Tag names are visible to relay operators. Moving tags inside the encrypted payload would lose relay-side filtering.

3. **No delta updates** — Re-uploading a modified file creates a new torrent. No incremental sync or conflict resolution.

4. **5 GB per-file limit** — Configurable via `LOCKER_MAX_FILE_SIZE` env var.

5. **CGNAT prevents direct peer connections** — VPS is the reliable seed. Devices behind CGNAT can download from VPS but not directly from each other without relay/TURN infrastructure.

6. **Self-custody key loss** — If a self-custody user loses their mnemonic, all encrypted metadata is permanently inaccessible. Files still exist on the torrent network but cannot be discovered.

## Security Considerations

See `docs/locker-security.md` for the full threat model including:
- What the server can/cannot see for custodial vs self-custody users
- Compromised server impact analysis
- Network observer protections
- NIP-44 v2 implementation details
- Self-encryption and sharing encryption flows

## Future Improvements

1. Client-side file content encryption (encrypt before upload)
2. Cleartext tag removal (trade-off: loses relay-side filtering)
3. Zero-knowledge storage proofs
4. Delta updates / incremental sync
5. File versioning with conflict resolution
6. Thumbnail generation for image previews
7. File drag-out from locker to desktop (Electron native drag)
