# Data Locker — User Guide

> Personal encrypted file storage powered by Nostr + BitTorrent

## What Is the Data Locker?

The Data Locker turns your BoilerDeck account into a personal encrypted file vault. Upload files from any device, and they become available on all your devices via BitTorrent — with encrypted metadata published to Nostr relays for cross-device discovery.

**Key features:**
- Upload any file type (up to 5 GB per file, 50 GB total)
- Files available from any device running the BoilerDeck desktop client
- Encrypted metadata — your filenames and tags are private
- Share files with other BoilerDeck users via end-to-end encryption
- Works offline — uploads queue and retry automatically

## Getting Started

### Desktop Client (Full Access)

1. Open BoilerDeck Desktop and sign in
2. Click **Locker** in the sidebar navigation
3. Click **Upload File** or drag-and-drop files onto the page
4. Your files appear in the locker with a cloud icon (available on relay)
5. On other devices, sign in and the files appear automatically

### Web Storefront (Read-Only)

1. Visit boilerdeck.com and sign in
2. Click **Locker** in the navigation header
3. Browse your locker entries — view metadata, copy magnet links
4. To download, use the desktop client or a compatible torrent client

## Uploading Files

### File Upload
Click the **Upload File** button in the toolbar, or use the keyboard shortcut **Ctrl+U** (Cmd+U on Mac). A native file picker opens — select any file up to 5 GB.

### Directory Upload
Click the folder icon next to the upload button. The selected directory is zipped into a single archive before uploading.

### Drag and Drop
Drag files from your desktop directly onto the locker page. The drop zone highlights when a file is dragged over it.

### Tags
Organize your files with tags (virtual folders). Tags can be added during upload and used as filters in the toolbar. Click tag chips below the toolbar to filter by tag.

## Downloading Files

Files in your locker have status indicators:
- **Cloud icon** — available on relay, not downloaded locally
- **Download arrow** — currently downloading (with progress %)
- **Check mark** — downloaded and verified locally
- **Seed icon** — actively seeding to the swarm

Click **Download** on any entry, or select multiple entries and click **Download All**. Downloads are verified with SHA-256 to ensure integrity.

Configure the download location in Settings (default: `~/BoilerDeck/Locker/`).

## Sharing Files

Share individual files with other BoilerDeck users:

1. Right-click a file (or use the context menu) and select **Share**
2. Enter the recipient's Nostr public key (64-character hex)
3. The file is re-encrypted to the recipient's key — only they can decrypt it
4. The recipient sees it in their **Shared with me** tab

To revoke a share, the sender publishes a deletion event. This does not delete the sender's copy.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+U / Cmd+U | Upload file |
| Ctrl+A / Cmd+A | Select all visible entries |
| Delete | Delete selected entries |
| Enter | Download or open selected entry |
| Escape | Clear selection |

## Batch Operations

Select multiple files using:
- **Click** — select single entry
- **Ctrl+Click** — toggle selection
- **Shift+Click** — select range

When multiple entries are selected, a batch action bar appears with **Download All** and **Delete All** buttons.

## Offline Mode

The locker works gracefully when you're offline:

- **Queued uploads** — if the server is unreachable, uploads queue locally and retry with exponential backoff (up to 10 retries)
- **Cached entries** — the locker shows cached entries from your last sync
- **Status banners** — amber banners indicate offline state, queued uploads, or relay disconnection
- **Last synced** — a timestamp shows when entries were last synchronized

Use the **Retry Now** button to manually trigger queue processing.

## Data Export

Click **Export Index** in the toolbar to save your locker index as a JSON file. This backup includes all entry metadata (filenames, sizes, hashes, magnet URIs) but not the file contents themselves.

## Encryption & Privacy

### Custody Modes

- **Custodial** (default) — the server manages your encryption key. Convenient but the server can read your metadata.
- **Self-custody** — you manage your own key locally. The server stores your files but cannot read filenames, tags, or other metadata.

Look for the encryption badge on the locker page:
- **"End-to-end encrypted"** — self-custody mode
- **"Server-managed encryption"** — custodial mode

### What's Protected

| Data | Custodial | Self-Custody |
|------|-----------|-------------|
| Filenames | Server can read | Encrypted |
| Tags/folders | Server can read | Encrypted |
| MIME types | Server can read | Encrypted |
| File content | Server has raw bytes | Server has raw bytes |
| File sizes | Visible | Visible |

For full details, see [locker-security.md](locker-security.md).

## Storage Quota

Each user has a 50 GB storage quota (configurable by admin). The quota bar at the top of the locker page shows current usage. Deleted files are soft-deleted with a 30-day retention period before permanent removal.

## FAQ

**Q: Is this like Dropbox/Google Drive?**
No. The Data Locker is not real-time file sync. There's no conflict resolution or delta updates. It's a personal content vault — "my files, available from any device."

**Q: Can the server read my files?**
The server has the raw file bytes (it seeds the torrents). Metadata (filenames, tags) is encrypted for self-custody users. See the security model docs for full details.

**Q: What happens if I lose my mnemonic (self-custody)?**
You lose access to all encrypted metadata permanently. The files still exist on the torrent network, but you can't find them without decrypting your locker events. Always back up your mnemonic.

**Q: Can I use my own torrent client?**
Yes — copy the magnet link from any locker entry and use any BitTorrent client to download.

**Q: What's the file size limit?**
5 GB per file, 50 GB total per user. These limits are configurable by the platform administrator.
