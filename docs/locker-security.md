# Data Locker Security Model

> Last updated: Phase 9.11 — End-to-End Encryption Verification

## Overview

The Data Locker provides encrypted personal file storage using Nostr events (NIP-78, kind 30078) for metadata and BitTorrent for file distribution. Metadata (filenames, tags, MIME types, content hashes) is encrypted with NIP-44 (XChaCha20-Poly1305). File contents are distributed as raw bytes via torrent.

Two custody modes exist:

- **Custodial** — Server manages the user's signing/encryption key. Key is encrypted at rest in Redis with `SIGNING_CACHE_KEY` (AES-256-GCM). The server decrypts and re-encrypts metadata on behalf of the user.
- **Self-custody** — User manages their own key locally (Electron desktop client). The server never has access to the private key. All encryption, signing, and event creation happens client-side.

---

## What the Server CAN See (All Users)

Regardless of custody mode, the VPS operator can observe:

| Data | Why |
|------|-----|
| **File bytes (raw content)** | VPS seeds all torrents via Transmission — file content lives on disk |
| **File sizes** | Raw bytes pass through the upload endpoint |
| **User ID / pubkey** | Authentication required for upload |
| **Timestamps** | Event `created_at`, upload time, HTTP request logs |
| **Info hash** | Needed for Transmission seeding |
| **Number of files per user** | DB tracks `LockerFile` records and quota |
| **Storage quota usage** | DB tracks `LockerQuota` per user |

## What the Server CANNOT See (Self-Custody Users)

For self-custody users, the following metadata is encrypted inside the NIP-44 payload and never exposed to the server:

| Data | Protection |
|------|------------|
| **Filenames** | Inside NIP-44 encrypted `LockerEntry.filename` |
| **File tags / folders** | Inside NIP-44 encrypted `LockerEntry.tags` |
| **MIME type associations** | Inside NIP-44 encrypted `LockerEntry.mimeType` |
| **File content hashes (SHA-256)** | Inside NIP-44 encrypted `LockerEntry.sha256` |
| **Magnet URIs** | Inside NIP-44 encrypted `LockerEntry.magnetUri` |
| **Entry version** | Inside NIP-44 encrypted `LockerEntry.version` |

The server stores the encrypted Nostr event but cannot derive the conversation key without the user's private key.

## What the Server CANNOT See (Custodial Users)

For custodial users, the server **can** see all metadata because it holds the decryption key in Redis. However:

| Protection | Detail |
|-----------|--------|
| **Keys encrypted at rest** | Private keys in Redis are encrypted with `SIGNING_CACHE_KEY` (AES-256-GCM: nonce:tag:ciphertext format) |
| **Keys are session-scoped** | Cached keys expire with the user's session; they are not stored permanently in the database in plaintext |
| **Database stores encrypted privkey** | The DB column `encryptedPrivkey` uses a different encryption layer (v1:salt:nonce:tag:ciphertext with app-level `SIGNING_CACHE_KEY`) |
| **Key access is explicit** | Server only decrypts the key when needed: upload, list entries, share, delete |

---

## Threat Model

### 1. Compromised Server (attacker gains root access to VPS)

| Impact on Custodial Users | Impact on Self-Custody Users |
|--------------------------|------------------------------|
| Full metadata access — attacker can decrypt Redis-cached keys and read all locker entry metadata | No metadata access — encrypted events on disk/relay cannot be decrypted without the user's local private key |
| Full file content access — raw files are on disk | Full file content access — raw files are on disk (VPS seeds them) |
| Can impersonate user for new events (has signing key) | Cannot impersonate — no signing key available |

**Mitigation:** Self-custody mode. Even with a compromised server, self-custody users' metadata remains encrypted. File contents are visible but the attacker cannot associate filenames or tags with specific files.

### 2. Compromised Relay (attacker gains access to event store)

| What is exposed | What is protected |
|----------------|-------------------|
| Encrypted event payloads (base64 NIP-44 ciphertext) | Event content — cannot be decrypted without the user's private key |
| User pubkeys (event `pubkey` field) | Filenames, tags, magnet URIs |
| Event timestamps (`created_at`) | File sizes, SHA-256 hashes |
| Event tags: `d` (entry ID), `t` (user tags) — **Note:** `t` tags on the Nostr event are in cleartext | Content associations |

**Important caveat on `t` tags:** The `buildLockerEventTags()` function adds user-defined tags as cleartext `["t", tag]` entries on the Nostr event (for relay-side filtering). This means tag names (e.g., "documents", "photos") are visible to anyone who can read the event. The filename, SHA-256, magnet URI, and other metadata inside the encrypted content remain protected. This is a deliberate trade-off: cleartext tags enable efficient relay queries (`#t` filter) but leak organizational metadata.

### 3. Network Observer (passive traffic analysis)

| What is exposed | What is protected |
|----------------|-------------------|
| Torrent traffic (IP addresses, info hashes) via BitTorrent protocol | Metadata inside encrypted Nostr events |
| WebSocket connections to relay (IP + timing) | Event content (TLS encrypted in transit) |
| HTTP upload requests (IP + file sizes) | File content (HTTPS encrypted in transit) |

**Mitigation:** Users concerned about IP exposure from torrent traffic should use a VPN. Torrent peers can see which info hashes a client is downloading/seeding.

### 4. Honest-but-Curious Operator (BoilerDeck itself)

Same access level as "Compromised Server" for metadata. The operator:

- **Can** see all raw file contents on disk (regardless of custody mode)
- **Can** decrypt custodial users' metadata (holds Redis encryption key)
- **Cannot** decrypt self-custody users' metadata
- **Cannot** associate a raw file on disk with a specific filename for self-custody users (the filename-to-infoHash mapping is inside the encrypted event)

---

## Important Caveat: File Content vs. Metadata

Encryption in the Data Locker protects **metadata** (filenames, tags, MIME types, content hashes, magnet URIs) — NOT the file content itself.

The VPS has the raw file bytes because it seeds the torrents. A server operator can:
- Browse all locker files on disk
- Inspect file contents directly

What the operator **cannot do** for self-custody users:
- Know which user uploaded which file (the user-to-file mapping is via encrypted events)
- Know what files are named
- Know how files are organized (tags/folders)

This is by design: the VPS must have the raw bytes to seed them. True end-to-end file content encryption would require the VPS to seed encrypted blobs, which would prevent it from serving usable files to the user's other devices without a separate decryption step.

---

## Encryption Implementation Details

### NIP-44 v2 Specification

- **Algorithm:** XChaCha20-Poly1305
- **Key derivation:** ECDH (secp256k1) shared secret -> HKDF-SHA256 with salt "nip44-v2" -> 32-byte conversation key
- **Nonce:** 24 bytes, randomly generated per encryption
- **Padding:** NIP-44 padding scheme (2-byte length prefix + pad to next power of 2, minimum 32 bytes)
- **Payload format:** `base64(0x02 || nonce || ciphertext || poly1305_tag)`

### Self-Encryption (Locker Entries)

For self-addressed messages (user encrypts to own pubkey), the ECDH shared secret is `ECDH(privkey, own_pubkey)`. This is deterministic — the conversation key is always the same for a given keypair. Each encryption still uses a unique random nonce, so ciphertexts differ even for identical plaintexts.

### Sharing (Re-encryption to Recipient)

When sharing, the sender:
1. Decrypts the entry using their own key
2. Re-encrypts the plaintext to the recipient's pubkey using `nip44Encrypt(plaintext, senderPrivkey, recipientPubkey)`
3. The recipient decrypts using `nip44Decrypt(ciphertext, recipientPrivkey, senderPubkey)`

The shared copy is a separate Nostr event. The original entry remains encrypted to the sender's own pubkey.

### Code Locations

| Module | Path | Purpose |
|--------|------|---------|
| Server NIP-44 | `server/packages/auth/src/nip44.ts` | Encryption/decryption for custodial users |
| Client NIP-44 | `client/src/main/nip44.ts` | Encryption/decryption for self-custody users (async, dynamic imports for ESM compat) |
| Locker service | `server/packages/locker/src/service.ts` | Upload/list/delete/share orchestration |
| Client locker manager | `client/src/main/lockerManager.ts` | Self-custody upload/download/sync |
| Shared types | `server/packages/shared/src/locker.ts` | `LockerEntry` type, serialization, validation |

### Server Key Access Pattern (Custodial)

The server accesses the user's private key via `getUserPrivkeyHex(userId)` which:
1. Checks `custodyMode` — throws `UnauthorizedError` for `SELF_CUSTODY` users (server must not handle their keys)
2. Reads encrypted key from Redis (`signing_key:{userId}`)
3. Decrypts with `SIGNING_CACHE_KEY` (AES-256-GCM: nonce:tag:ciphertext)
4. Returns the hex private key

Key access only occurs in these service functions:
- `uploadFile()` — encrypt entry after torrent creation
- `listEntries()` — decrypt entries for API response
- `deleteEntry()` — decrypt entry to get infoHash for Transmission removal
- `shareEntry()` — decrypt sender's entry, re-encrypt to recipient
- `getSharedWithMe()` — decrypt shared entries

---

## Recommendations

### For Users

1. **Use self-custody mode** for maximum metadata privacy. The server cannot read your filenames, tags, or file organization.
2. **Understand the limits:** The VPS has your raw file bytes (it seeds them). Metadata encryption does not protect file content from the server operator.
3. **Back up your mnemonic.** Self-custody means losing your key = losing access to all encrypted metadata permanently. The files still exist on the torrent network but you cannot find them without decrypting your locker events.

### Future Enhancements

1. **Client-side file content encryption:** Encrypt files before uploading so the VPS seeds encrypted blobs. This would require recipient-side decryption after torrent download. Trade-off: adds complexity, prevents server-side deduplication by content hash.
2. **Cleartext tag removal:** Move user tags inside the encrypted payload only (remove `t` tags from event). Trade-off: loses relay-side tag filtering capability — clients would need to download and decrypt all events to filter by tag.
3. **Zero-knowledge storage proofs:** Allow users to verify the VPS is storing their files without revealing which files belong to which user.

---

## Audit Summary (Phase 9.11)

### Custodial Path — Findings

- **By design:** Server decrypts/re-encrypts metadata. Custodial users explicitly trust the server.
- **Keys encrypted at rest:** Redis-cached keys use AES-256-GCM with `SIGNING_CACHE_KEY`. DB-stored keys use a separate encryption layer.
- **Key access is scoped:** `getUserPrivkeyHex()` explicitly rejects `SELF_CUSTODY` users — prevents accidental key access for the wrong custody mode.
- **No unnecessary key exposure:** The private key hex is only held in memory during the specific operation, not stored in any global state.

### Self-Custody Path — Findings

- **Torrent created locally:** `createTorrentFromFile()` in `lockerManager.ts` uses WebTorrent's seed API entirely in the Electron main process.
- **Event encrypted locally:** `nip44Encrypt()` from `client/src/main/nip44.ts` encrypts the `LockerEntry` JSON with the user's local private key before any network call.
- **Event signed locally:** `keyManager.signEvent()` signs using the locally stored private key (never transmitted).
- **Only encrypted event + raw bytes sent to server:** The `uploadRawToVps()` function sends the file bytes and `.torrent` file with a `self_custody=true` flag. No metadata (filename, tags) is sent in cleartext — only the multipart file with a generic filename.
- **Server cannot decrypt:** The server receives and stores the encrypted event but has no access to the self-custody user's private key.

### Gaps and Observations

1. **Cleartext `t` tags on events:** User-defined tags appear as cleartext `["t", tag]` on the Nostr event. This leaks organizational metadata (tag names) to relay operators and subscribers. This is intentional for filtering but should be documented clearly for users.
2. **`self_custody` flag in upload:** The `uploadRawToVps()` function includes the original filename in the multipart `Content-Disposition` header. While the server doesn't store this as metadata (it uses `entryId` for storage paths), it briefly appears in HTTP logs. Consider using a generic filename for the upload.
3. **File content is not encrypted:** As documented above, this is a fundamental architecture choice — the VPS must seed usable torrent content. Users needing file content privacy should encrypt files before uploading (not yet supported as a built-in feature).
