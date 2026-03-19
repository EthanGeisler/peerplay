# Data Locker Plan — Phase 9

> Personal encrypted file storage using Nostr events + BitTorrent
> Each user gets a "data locker" — files torrented between their devices,
> with encrypted metadata published to Nostr relays for cross-device discovery.

---

## Overview

The Data Locker turns every BoilerDeck account into a personal encrypted file vault.
Users upload files from any device → a torrent is created → encrypted metadata is
published as a Nostr event → other devices subscribe, decrypt, and download via
BitTorrent. The VPS acts as a persistent seed so files remain available even when
all user devices are offline.

**Core flow:**
```
Device A: file → torrent → encrypt metadata → publish to relay
                                                    ↓
Relay:                              encrypted NIP-44 event (kind 30078)
                                                    ↓
Device B:               subscribe → decrypt → join swarm → download
                                                    ↑
VPS:                              persistent seed (always available)
```

**What this is NOT:**
- Not real-time file sync (no conflict resolution, no delta updates)
- Not a replacement for Syncthing/Dropbox for live collaboration
- IS a personal content locker — "my files, available from any device"

---

## Phase 9: Data Locker

### 9.1 — Locker Event Schema & Types

**Goal:** Define the Nostr event kind and TypeScript types for locker entries.

**Tasks:**
- [x] Define new event kind `30078` (NIP-78 "Application-specific data") for locker entries
- [x] Create `LockerEntry` type in `server/packages/shared/src/events.ts`:
  ```typescript
  interface LockerEntry {
    id: string;              // unique entry ID (uuid)
    filename: string;        // original filename
    size: number;            // file size in bytes
    mimeType: string;        // detected MIME type
    sha256: string;          // file content hash for integrity
    infoHash: string;        // torrent info hash
    magnetUri: string;       // full magnet URI with trackers
    createdAt: number;       // unix timestamp
    tags: string[];          // user-defined tags/folders
    version: number;         // entry version (for updates)
  }
  ```
- [x] The `content` field of the Nostr event holds NIP-44 encrypted JSON of `LockerEntry`
- [x] Tags on the event: `["d", entryId]` (parameterized replaceable — allows updates)
- [x] Add `LOCKER_ENTRY = 30078` to kind constants in `shared/src/events.ts`
- [x] Create `server/packages/shared/src/locker.ts` with serialization/validation helpers
- [x] Write unit tests for schema validation and serialization

**Key decisions:**
- Kind 30078 (NIP-78) is specifically designed for app-specific data — avoids collision
- Parameterized replaceable (`d` tag) so updating a file replaces the old event
- Content is encrypted so relay operators (including us) cannot read user files metadata
- SHA-256 of file content provides integrity verification after download

**Handoff:** `docs/handoff/9.1.md`

---

### 9.2 — NIP-44 Encryption Module

**Goal:** Implement NIP-44 encrypted payloads for self-addressed messages (user encrypts to their own pubkey).

**Tasks:**
- [x] Add `@noble/ciphers` dependency (for xchacha20-poly1305, NIP-44 spec)
- [x] Create `server/packages/auth/src/nip44.ts`:
  - `nip44Encrypt(plaintext: string, senderPrivkey: string, recipientPubkey: string): string`
  - `nip44Decrypt(ciphertext: string, receiverPrivkey: string, senderPubkey: string): string`
  - Conversation key derivation: ECDH shared secret → HKDF-SHA256
  - For self-addressed: sender === recipient, so shared secret is ECDH(privkey, own_pubkey)
- [x] Create matching client-side module `client/src/main/nip44.ts` using same logic
- [x] Handle the self-encryption case explicitly (encrypt to own pubkey for locker)
- [x] Support encrypt-to-other for future sharing (encrypt to friend's pubkey)
- [x] Unit tests: round-trip, cross-module compatibility (server encrypts, client decrypts)
- [x] Test vectors from NIP-44 spec

**Key decisions:**
- NIP-44 over NIP-04: NIP-04 is deprecated (CBC mode, no padding, metadata leaks). NIP-44 uses XChaCha20-Poly1305 with proper padding.
- Self-encryption: user encrypts to their own pubkey. The ECDH shared secret with yourself is deterministic — `ecdh(privkey, pubkey)` always yields the same conversation key.
- Same module on server (for custodial users) and client (for self-custody users).

**Handoff:** `docs/handoff/9.2.md`

---

### 9.3 — Server Locker API (Upload & Index)

**Goal:** Server endpoints for uploading files to the locker and managing entries.

**Tasks:**
- [x] Create `server/packages/locker/` package (new package in monorepo):
  - `src/routes.ts` — Express router
  - `src/service.ts` — business logic
  - `src/storage.ts` — file storage abstraction
- [x] `POST /api/locker/upload` — multipart file upload:
  1. Authenticate user (JWT middleware)
  2. Save file to `LOCKER_DIR/<userId>/<entryId>/`
  3. Compute SHA-256 hash
  4. Create torrent via existing `torrent/service.ts`
  5. Send torrent to Transmission RPC for VPS seeding
  6. Build `LockerEntry` JSON
  7. Encrypt with NIP-44 (to user's own pubkey)
  8. Create & sign Nostr event (kind 30078)
  9. Publish to relay
  10. Return `{ entryId, infoHash, eventId }`
- [x] `GET /api/locker/entries` — list user's locker entries:
  1. Query relay for user's kind 30078 events
  2. Decrypt each entry (server-side for custodial users)
  3. Return decrypted `LockerEntry[]`
- [x] `DELETE /api/locker/entries/:entryId` — remove entry:
  1. Publish a delete event (kind 5, NIP-09) referencing the entry
  2. Remove torrent from Transmission
  3. Delete files from `LOCKER_DIR`
- [x] `GET /api/locker/entries/:entryId/torrent` — download .torrent file
- [x] Add `LOCKER_DIR` to config.ts (default: `./data/locker/`)
- [x] Add locker routes to Express app in `server/src/index.ts`
- [x] File size limit: 5 GB per file (configurable via env `LOCKER_MAX_FILE_SIZE`)
- [x] Storage quota: 50 GB per user (configurable via env `LOCKER_QUOTA_GB`)

**Key decisions:**
- Separate package (not catalog) — locker files are personal, not marketplace listings
- VPS seeds all locker files — ensures availability when user devices are offline
- Quota system prevents abuse — 50 GB default, can be increased per-user later
- Delete uses NIP-09 (event deletion) so relays propagate the removal

**Handoff:** `docs/handoff/9.3.md`

---

### 9.4 — Prisma Schema & Storage Tracking

**Goal:** Database models for tracking locker storage usage and file metadata.

**Tasks:**
- [x] Add Prisma models:
  ```prisma
  model LockerFile {
    id          String   @id @default(uuid())
    userId      String   @map("user_id")
    entryId     String   @unique @map("entry_id")  // matches Nostr event d-tag
    filename    String
    size        BigInt                               // bytes
    infoHash    String   @map("info_hash")
    torrentPath String   @map("torrent_path")        // path to .torrent file
    filePath    String   @map("file_path")            // path to stored file
    createdAt   DateTime @default(now()) @map("created_at")
    deletedAt   DateTime? @map("deleted_at")          // soft delete
    user        User     @relation(fields: [userId], references: [id])

    @@map("locker_files")
    @@index([userId])
  }

  model LockerQuota {
    id          String   @id @default(uuid())
    userId      String   @unique @map("user_id")
    usedBytes   BigInt   @default(0) @map("used_bytes")
    maxBytes    BigInt   @map("max_bytes")           // default 50 GB
    user        User     @relation(fields: [userId], references: [id])

    @@map("locker_quotas")
  }
  ```
- [x] Add `lockerFiles` and `lockerQuota` relations to `User` model
- [x] Create migration: `npx prisma migrate dev --name add-locker-tables`
- [x] Add quota check middleware to upload endpoint (reject if over quota)
- [x] Update quota `usedBytes` on upload and delete
- [x] Soft-delete pattern: set `deletedAt`, decrement quota, remove from Transmission
- [x] Add quota info to `GET /api/locker/entries` response: `{ entries: [...], quota: { used, max } }`

**Key decisions:**
- BigInt for file sizes (files can exceed 2 GB, JS number precision limit)
- Soft delete with `deletedAt` — allows recovery window, matches existing patterns
- Quota tracked in DB (not computed on-the-fly) for performance
- `@@map` for snake_case DB names — matches Phase 7 convention

**Handoff:** `docs/handoff/9.4.md`

---

### 9.5 — Client Locker Upload (Electron)

**Goal:** Desktop client can upload files from local filesystem to the data locker.

**Tasks:**
- [x] Create `client/src/main/lockerManager.ts`:
  - `uploadFile(filePath: string, tags?: string[]): Promise<LockerEntry>`
  - `uploadDirectory(dirPath: string, tags?: string[]): Promise<LockerEntry>` (zips first)
  - Reads file, computes SHA-256 locally
  - Uploads to `POST /api/locker/upload`
  - For self-custody users: creates torrent locally, signs event locally, publishes to relay directly
- [x] Add IPC handlers in `client/src/main/index.ts`:
  - `locker:upload-file` — opens file dialog, uploads selected file
  - `locker:upload-directory` — opens directory dialog, zips and uploads
  - `locker:get-entries` — fetches user's locker entries
  - `locker:delete-entry` — deletes a locker entry
  - `locker:download-entry` — downloads a locker entry to local path
- [x] File dialog integration: native OS file picker via `dialog.showOpenDialog()`
- [x] Upload progress: stream upload with progress events via IPC
- [x] Self-custody path (no server upload):
  1. Create torrent locally (using `create-torrent` package, already a dependency)
  2. Encrypt LockerEntry with NIP-44 using local key (keyManager)
  3. Sign event locally
  4. Publish directly to relay via WebSocket
  5. Start seeding via WebTorrent
  6. POST torrent to VPS Transmission for persistent seeding
- [x] Handle large files: chunked upload with resume capability

**Key decisions:**
- Dual path: custodial users upload through server API; self-custody users create everything locally
- Self-custody path publishes directly to relay — server never sees the private key or unencrypted metadata
- Directory upload zips contents first — single torrent per upload, simpler management
- VPS seeding for both paths — even self-custody users benefit from persistent availability

**Handoff:** `docs/handoff/9.5.md`

---

### 9.6 — Client Locker Download & Sync

**Goal:** Desktop client subscribes to locker events and downloads files on demand.

**Tasks:**
- [x] Add relay subscription for locker events in `client/src/main/lockerManager.ts`:
  - Subscribe: `["REQ", subId, { kinds: [30078], authors: [userPubkey] }]`
  - On new event: decrypt NIP-44, parse LockerEntry, notify renderer
  - On delete event (kind 5): remove from local index
- [x] Create local locker index in `client/src/main/lockerStore.ts`:
  - SQLite or JSON file at `userData/locker-index.json`
  - Tracks: entryId, filename, size, downloadStatus, localPath
  - States: `available` (on relay, not downloaded), `downloading`, `downloaded`, `seeding`
- [x] Download flow:
  1. User clicks download on a locker entry
  2. Decrypt magnetUri from the LockerEntry
  3. Download via WebTorrent to `LOCKER_DOWNLOAD_DIR/<entryId>/`
  4. Verify SHA-256 matches
  5. Update local index status → `downloaded`
  6. Optionally continue seeding (configurable)
- [x] Auto-download option: setting to auto-download new locker entries
- [x] Download location: configurable via settings (default: `~/BoilerDeck/Locker/`)
- [x] Seed-after-download toggle: if enabled, keep seeding downloaded locker files
- [x] Background sync: check for new locker events on app startup and periodically (5 min interval)
- [x] Conflict handling: if same `d`-tag arrives with higher `version`, prompt user to update

**Key decisions:**
- On-demand download (not auto-sync by default) — users control bandwidth and storage
- Auto-download as opt-in setting for power users who want full sync
- SHA-256 verification ensures file integrity after torrent download
- Seed-after-download improves swarm health (user's devices help each other)
- JSON index file (not SQLite) — simpler, sufficient for metadata-only storage

**Handoff:** `docs/handoff/9.6.md`

---

### 9.7 — Locker UI (Electron Renderer)

**Goal:** Full UI for browsing, uploading, downloading, and managing locker files.

**Tasks:**
- [x] Create `client/src/renderer/pages/LockerPage.tsx`:
  - File browser view (grid and list toggle)
  - Upload button (file and folder)
  - Drag-and-drop upload zone
  - Search/filter by filename and tags
  - Sort by name, size, date
  - Quota usage bar (used / max)
- [x] Create `client/src/renderer/components/locker/`:
  - `LockerFileCard.tsx` — file entry with icon, name, size, status badge
  - `LockerUploadZone.tsx` — drag-and-drop area with progress
  - `LockerToolbar.tsx` — search, filter, sort, view toggle
  - `LockerQuotaBar.tsx` — storage usage indicator
  - `LockerFolderTree.tsx` — tag-based folder navigation (tags as virtual folders)
- [x] Create `client/src/renderer/stores/lockerStore.ts` (Zustand):
  - State: entries, uploadQueue, downloadQueue, quota, viewMode, filters
  - Actions: upload, download, delete, refresh, setFilter, setViewMode
- [x] File type icons: detect by extension, show appropriate icon
- [x] Status indicators per entry:
  - Cloud icon: available on relay, not downloaded locally
  - Download arrow: currently downloading (with progress %)
  - Check mark: downloaded and verified
  - Upload arrow: currently uploading
  - Seed icon: actively seeding to swarm
- [x] Context menu (right-click): Download, Open file location, Copy magnet link, Delete, Edit tags
- [x] Upload progress: inline progress bar per file, total progress in toolbar
- [x] Add "Locker" nav item to sidebar (between Library and Settings)
- [x] Empty state: illustration + "Upload your first file" CTA
- [x] Responsive layout: adapts to window resize

**Key decisions:**
- Tag-based virtual folders (not actual directory hierarchy) — simpler, more flexible
- Zustand store mirrors existing patterns (gameStore, libraryStore, authStore)
- Grid + list view toggle follows existing UI patterns in the library page
- Drag-and-drop is expected UX for file upload — native feel in Electron

**Handoff:** `docs/handoff/9.7.md`

---

### 9.8 — Web Locker View (Read-Only)

**Goal:** Web storefront shows locker contents (download links only — upload requires desktop client).

**Tasks:**
- [x] Create `web/src/pages/LockerPage.tsx`:
  - Login-gated page
  - Lists locker entries fetched from `GET /api/locker/entries`
  - Shows file metadata (name, size, date, tags)
  - Download button: generates magnet link for each entry
  - "Download with BoilerDeck" deep link (opens desktop client)
  - Quota usage display
- [x] Create `web/src/stores/lockerStore.ts` (Zustand)
- [x] Add "Locker" nav item to web header (authenticated users only)
- [x] No upload from web — show banner: "Install BoilerDeck Desktop to upload files"
- [x] Mobile-responsive layout
- [x] File preview for images: thumbnail generation (server-side, on upload)

**Key decisions:**
- Web is read-only — upload requires Electron for local file access and torrent creation
- Deep links to desktop client for download — web can't run WebTorrent efficiently
- Magnet link fallback for users who want to use their own torrent client
- Minimal server-side rendering — SPA pattern matches existing web storefront

**Handoff:** `docs/handoff/9.8.md`

---

### 9.9 — Locker Sharing (Encrypted to Recipient)

**Goal:** Users can share individual locker entries with other BoilerDeck users via NIP-44 encryption to the recipient's pubkey.

**Tasks:**
- [x] Add share functionality to locker:
  - `POST /api/locker/share` — `{ entryId, recipientPubkey }`
  - Creates a new kind 30078 event encrypted to recipient's pubkey (not sender's)
  - Adds tags: `["p", recipientPubkey]`, `["d", newShareId]`, `["shared-from", senderPubkey]`
- [x] Recipient's client detects shared entries:
  - Subscribe: `["REQ", subId, { kinds: [30078], "#p": [myPubkey] }]`
  - Decrypt with own private key
  - Display in "Shared with me" section of locker
- [x] Share UI in desktop client:
  - "Share" option in context menu
  - Search/select recipient by username or npub
  - Confirmation dialog with recipient name and file info
  - Shared entries show sender name and share date
- [x] Share UI in web:
  - Same share dialog (but uses server-side encryption for custodial users)
- [x] Revoke share:
  - Publish delete event (kind 5) for the shared event
  - Does NOT delete the sender's copy
- [x] Shared entries don't count against recipient's quota (sender's VPS seed serves them)
- [x] Rate limit: max 100 shares per hour per user

**Key decisions:**
- NIP-44 to recipient pubkey — only the recipient can decrypt the magnet link
- Separate event per share (not modifying original) — sender's copy is independent
- `#p` tag enables recipient subscription without scanning all events
- Revokable via NIP-09 delete — sender can un-share at any time
- Shared files served from sender's VPS allocation — no double-storage

**Handoff:** `docs/handoff/9.9.md`

---

### 9.10 — VPS Seed Management & Cleanup

**Goal:** Server-side management of locker torrents — seeding, cleanup, and storage optimization.

**Tasks:**
- [x] Create `server/packages/locker/src/seedManager.ts`:
  - Track all active locker torrents in Transmission
  - Prioritize seeding: recently accessed files > old files
  - Auto-pause torrents for deleted entries (after grace period)
  - Storage monitoring: alert when VPS disk usage exceeds threshold
- [x] Cleanup cron job (`scripts/locker-cleanup-cron.ts`):
  - Run every 6 hours
  - Remove files with `deletedAt` older than 30 days
  - Remove orphaned torrents (no matching DB entry)
  - Log storage stats
- [x] Storage deduplication:
  - Check SHA-256 before storing — if identical file exists, reference existing torrent
  - Multiple users uploading same file → single torrent, multiple events
  - Dedup saves VPS storage significantly for popular files
- [x] Seed attestation for locker files:
  - Extend existing `seed-attestation-cron.ts` to include locker torrents
  - Users can verify their files are being seeded by the VPS
- [x] Health check endpoint: `GET /api/locker/health`
  - Transmission connection status
  - Total locker storage used
  - Active/paused torrent counts
  - Per-user storage breakdown (admin only)
- [x] VPS storage config:
  - `LOCKER_STORAGE_DIR` — where files live on disk
  - `LOCKER_MAX_STORAGE_GB` — total VPS allocation for locker (default: 500 GB)
  - `LOCKER_RETENTION_DAYS` — days to keep deleted files (default: 30)

**Key decisions:**
- Deduplication by SHA-256 — huge storage savings, especially for common files
- 30-day retention on deleted files — allows "undo" without permanent storage cost
- Separate cron from marketplace seed attestation — different lifecycle
- Transmission priority system prevents VPS from being overwhelmed by inactive files

**Handoff:** `docs/handoff/9.10.md`

---

### 9.11 — End-to-End Encryption Verification

**Goal:** Ensure the locker is truly end-to-end encrypted — verify that the server never sees plaintext metadata for self-custody users.

**Tasks:**
- [x] Audit all locker code paths for encryption correctness:
  - Custodial path: server decrypts (by design — user trusts server with key)
  - Self-custody path: server NEVER has access to private key or plaintext
- [x] Self-custody upload audit:
  - [x] Torrent created locally ✓
  - [x] LockerEntry JSON encrypted locally with NIP-44 ✓
  - [x] Event signed locally ✓
  - [x] Only encrypted event + raw file bytes sent to server
  - [x] Server stores file but cannot read metadata (filename, tags, etc.)
- [x] Add E2E encryption integration tests:
  - Test: self-custody user uploads → server stores → verify server cannot decrypt event content
  - Test: self-custody user on Device A uploads → Device B subscribes → Device B decrypts → content matches
  - Test: shared entry → only recipient can decrypt
  - Test: relay operator cannot read locker entry content
- [x] Document encryption guarantees in `docs/locker-security.md`:
  - What the server can see (file size, user ID, timestamps)
  - What the server cannot see (filenames, tags, content)
  - Threat model: compromised server, compromised relay, network observer
- [x] Add encryption indicator to UI:
  - Lock icon on all locker entries
  - "End-to-end encrypted" badge for self-custody users
  - "Server-managed encryption" badge for custodial users
  - Tooltip explaining the difference

**Key decisions:**
- Self-custody is the gold standard — server is a blind storage+seed node
- Custodial users trade privacy for convenience (same tradeoff as existing key management)
- Explicit UI indicators so users understand their encryption level
- Security doc is essential for trust — users need to verify claims

**Handoff:** `docs/handoff/9.11.md`

---

### 9.12 — Offline & Resilience

**Goal:** Locker works gracefully when devices are offline, relay is down, or VPS is unavailable.

**Tasks:**
- [x] Offline upload queue:
  - If relay/server is unreachable, queue the upload locally
  - Retry on reconnection (exponential backoff)
  - Show "pending upload" status in UI
- [x] Local-first locker index:
  - Cache all decrypted locker entries in local store
  - UI loads from cache immediately, then syncs with relay
  - Show "last synced" timestamp
- [x] Peer-to-peer fallback:
  - If VPS seed is down, devices can still torrent directly between each other
  - DHT disabled (private torrents) — but peer exchange (PEX) between known peers works
  - Embed peer hints in locker events: `["peer", "ip:port"]` (optional, user-controlled)
- [x] Relay failover:
  - Try primary relay (boilerdeck.com)
  - Fall back to user's configured additional relays
  - Publish to multiple relays for redundancy
- [x] Graceful degradation UI:
  - Banner: "Offline — showing cached entries"
  - Banner: "VPS seed unavailable — direct device transfer only"
  - Banner: "Relay unreachable — uploads queued"
- [x] Data export: `locker:export-index` IPC — exports full locker index as JSON for backup

**Key decisions:**
- Local-first: UI never blocks on network — always show cached state
- Multi-relay publish for redundancy — matches Phase 8's relay management
- Peer hints are opt-in (privacy implication of embedding IP in events)
- Export enables users to back up their locker index independently

**Handoff:** `docs/handoff/9.12.md`

---

### 9.13 — Testing, Polish & Documentation

**Goal:** Comprehensive testing, performance optimization, and user-facing documentation.

**Tasks:**
- [x] Integration tests:
  - Full upload → relay → download cycle (custodial and self-custody)
  - Share → receive → download cycle
  - Delete → verify removal from relay + Transmission
  - Quota enforcement (upload rejected when over limit)
  - Deduplication (same file uploaded twice → single torrent)
- [x] Performance testing:
  - Upload 100 files rapidly — verify queue handling
  - 1000 locker entries — verify UI doesn't lag
  - 5 GB file upload — verify streaming/chunking works
  - Concurrent downloads from multiple devices
- [x] UX polish:
  - Keyboard shortcuts: Ctrl+U (upload), Delete (remove), Enter (download/open)
  - Drag files from locker to desktop (Electron drag-out)
  - File type previews: images (thumbnail), text (first 100 lines), PDF (first page)
  - Batch operations: select multiple → download all / delete all
- [x] Documentation:
  - User guide: `docs/locker-guide.md` — how to use the data locker
  - API docs: update `CONTEXT.md` with new endpoints
  - Update `CLAUDE.md` with locker package conventions
  - Update `VERIFICATION_CHECKS.md` with locker-specific checks
- [x] Update `DECENTRALIZATION_PLAN.md` to reference Phase 9
- [x] Write `docs/handoff/phase-9-summary.md`

**Key decisions:**
- Integration tests over unit tests for the locker — the value is in the full pipeline
- Performance targets: UI responsive with 1000+ entries, uploads don't block UI
- Documentation lives with existing docs — not a separate system

**Handoff:** `docs/handoff/9.13.md`

---

## Execution Order

Strict sequential — each sub-task depends on the previous:

```
9.1  Schema & Types ──────────────────── foundation
 ↓
9.2  NIP-44 Encryption ──────────────── encryption layer
 ↓
9.3  Server API ──────────────────────── upload/index/delete endpoints
 ↓
9.4  Prisma Schema ───────────────────── storage tracking
 ↓
9.5  Client Upload ───────────────────── Electron upload flow
 ↓
9.6  Client Download & Sync ──────────── Electron download flow
 ↓
9.7  Locker UI (Desktop) ────────────── full desktop interface
 ↓
9.8  Web Locker View ─────────────────── read-only web access
 ↓
9.9  Sharing ─────────────────────────── encrypted file sharing
 ↓
9.10 VPS Seed Management ────────────── server-side operations
 ↓
9.11 E2E Encryption Verification ────── security audit
 ↓
9.12 Offline & Resilience ───────────── graceful degradation
 ↓
9.13 Testing & Polish ───────────────── final quality pass
```

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| VPS storage costs scale with users | High hosting cost | Per-user quotas, deduplication, tiered storage |
| CGNAT prevents direct peer connections | Files only available via VPS | VPS always seeds; VPS is the reliable peer |
| NIP-44 implementation bugs leak metadata | Privacy breach | Phase 9.11 dedicated to encryption audit |
| Large file uploads timeout | Poor UX | Chunked upload with resume in 9.5 |
| Torrent overhead for small files | Slow for tiny files | Future: inline small files in Nostr event content |
| User loses mnemonic (self-custody) | Permanent locker access loss | Warning UI, recommend backup, custodial as default |
| Relay goes down | Can't discover new entries | Multi-relay redundancy in 9.12 |

## Storage Architecture

```
VPS Disk Layout:
├── /data/games/          ← existing marketplace content
├── /data/locker/         ← NEW: locker files
│   ├── <userId>/
│   │   ├── <entryId>/
│   │   │   ├── <original-filename>
│   │   │   └── <entryId>.torrent
│   │   └── ...
│   └── ...
└── /data/torrents/       ← existing .torrent files

Dedup Layer:
├── /data/locker-blobs/   ← content-addressed storage
│   ├── <sha256-prefix>/
│   │   └── <sha256-full> ← actual file bytes
│   └── ...
└── /data/locker/         ← user dirs contain symlinks to blobs
```

## Event Flow Diagram

```
UPLOAD (Custodial):
  Client → POST /api/locker/upload (file + metadata)
       → Server: save file, create torrent, add to Transmission
       → Server: build LockerEntry JSON
       → Server: NIP-44 encrypt with user's cached signing key
       → Server: sign event, publish to relay
       → Client: receives { entryId, eventId }

UPLOAD (Self-Custody):
  Client: create torrent locally, start seeding via WebTorrent
       → Client: build LockerEntry JSON
       → Client: NIP-44 encrypt with local private key
       → Client: sign event with keyManager
       → Client: publish to relay via WebSocket
       → Client: POST file + .torrent to VPS for persistent seeding
       → Server: stores file, adds to Transmission (no access to metadata)

DOWNLOAD (Any Device):
  Client: subscribe to relay for kind 30078 + own pubkey
       → Relay: sends encrypted events
       → Client: NIP-44 decrypt with private key
       → Client: parse LockerEntry, extract magnetUri
       → Client: download via WebTorrent (peers: VPS + other devices)
       → Client: verify SHA-256
       → Client: update local index → "downloaded"

SHARE:
  Sender: NIP-44 encrypt LockerEntry to recipient's pubkey
       → Sender: sign event with #p tag for recipient
       → Sender: publish to relay
       → Recipient: subscribe with #p filter
       → Recipient: decrypt, download via torrent
```
