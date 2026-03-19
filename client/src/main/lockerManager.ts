/**
 * Locker Manager — Electron main process module for data locker operations.
 *
 * Handles file/directory upload, entry listing, deletion, and download
 * for the personal encrypted data locker. Supports two paths:
 *
 * - Custodial: Upload file to server API, server handles torrent creation,
 *   NIP-44 encryption, event signing, and relay publishing.
 *
 * - Self-custody: Create torrent locally, encrypt with NIP-44 using local key,
 *   sign event locally, publish to relay via WebSocket, then POST raw file +
 *   .torrent to server for persistent VPS seeding.
 *
 * Uses dynamic imports for ESM-only packages (Electron main compiles to CJS).
 */

import { dialog, shell, type BrowserWindow } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as crypto from "node:crypto";
import * as https from "node:https";
import * as http from "node:http";
import WebSocket from "ws";
import { storeGet, storeSet, storeDelete } from "./store.js";
import * as keyManager from "./keyManager.js";
import * as relayManager from "./relayManager.js";
import type { RelayEvent } from "./relayManager.js";
import { nip44Encrypt, nip44Decrypt } from "./nip44.js";
import * as lockerStore from "./lockerStore.js";
import type { LockerIndexEntry, DownloadStatus } from "./lockerStore.js";
import * as lockerSettings from "./lockerSettings.js";
import * as uploadQueue from "./lockerUploadQueue.js";

// ─── Types ──────────────────────────────────────────────────────────

export interface LockerEntry {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  sha256: string;
  infoHash: string;
  magnetUri: string;
  createdAt: number;
  tags: string[];
  version: number;
  peerHints?: string[];
}

export interface ConnectionStatus {
  serverOnline: boolean;
  relayConnected: boolean;
  lastSynced: number; // unix timestamp ms
  uploadQueueCount: number;
}

export interface UploadResult {
  entryId: string;
  infoHash: string;
  eventId: string;
}

export interface ListResult {
  entries: LockerEntry[];
  quota: {
    used: number;
    max: number;
  };
}

interface UploadProgress {
  entryId: string;
  percent: number;
  bytesUploaded: number;
  bytesTotal: number;
}

interface DownloadProgress {
  entryId: string;
  percent: number;
  bytesDownloaded: number;
  bytesTotal: number;
}

// ─── State ──────────────────────────────────────────────────────────

let mainWindowRef: BrowserWindow | null = null;
let cachedAccessToken: string | null = null;

const API_BASE = "https://boilerdeck.com/api";
const RELAY_URL = "wss://boilerdeck.com/relay";
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Sync State ─────────────────────────────────────────────────────

let syncWs: WebSocket | null = null;
let syncSubId: string | null = null;
let syncUserPubkey: string | null = null;
let syncReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let syncReconnectAttempts = 0;
let syncIntentionalClose = false;
let syncPollTimer: ReturnType<typeof setTimeout> | null = null;

const MAX_SYNC_RECONNECT_DELAY = 60000; // 60s
const BASE_SYNC_RECONNECT_DELAY = 2000; // 2s

// ─── Connection Status ──────────────────────────────────────────────

let serverOnline = true;
let relayConnected = false;

// ─── Public API ─────────────────────────────────────────────────────

export function setMainWindow(win: BrowserWindow): void {
  mainWindowRef = win;
}

/**
 * Cache the access token from the renderer process.
 * Called via IPC before locker operations that need API access.
 */
export function setAccessToken(token: string | null): void {
  cachedAccessToken = token;
}

/**
 * Get the API base URL. Uses env override if present (for dev mode).
 */
function getApiBase(): string {
  return process.env.VITE_API_BASE_URL ?? API_BASE;
}

/**
 * Get the cached access token.
 */
function getAccessToken(): string | null {
  return cachedAccessToken;
}

/**
 * Ensure the cached access token is valid. If it looks expired or missing,
 * attempt a refresh using the stored refresh token.
 * Returns the valid token or throws.
 */
async function ensureValidToken(): Promise<string> {
  let token = getAccessToken();
  if (!token) {
    // Try refreshing — maybe the renderer set a token earlier that's now null
    token = await refreshAccessTokenMainProcess();
    if (!token) throw new Error("Not authenticated. Please log in first.");
  }
  return token;
}

/**
 * Send upload progress to the renderer process.
 */
function emitProgress(progress: UploadProgress): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send("locker:upload-progress", progress);
  }
}

function emitDownloadProgress(progress: DownloadProgress): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send("locker:download-progress", progress);
  }
}

function emitSyncUpdate(entries: LockerIndexEntry[]): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send("locker:sync-update", { entries });
  }
}

// ─── Network Helpers ────────────────────────────────────────────────

/**
 * Check if an error message indicates a network-level failure
 * (server unreachable, connection refused, timeout, DNS failure).
 */
function isNetworkError(message: string): boolean {
  const networkPatterns = [
    "ECONNREFUSED",
    "ENOTFOUND",
    "ECONNRESET",
    "ETIMEDOUT",
    "EHOSTUNREACH",
    "EAI_AGAIN",
    "connection refused",
    "timed out",
    "network",
    "fetch failed",
    "socket hang up",
  ];
  const lower = message.toLowerCase();
  return networkPatterns.some((p) => lower.includes(p.toLowerCase()));
}

// ─── MIME Detection ─────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  ".txt": "text/plain",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".exe": "application/x-msdownload",
  ".dmg": "application/x-apple-diskimage",
  ".iso": "application/x-iso9660-image",
  ".torrent": "application/x-bittorrent",
};

function detectMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

// ─── SHA-256 Hashing ────────────────────────────────────────────────

async function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

// ─── HTTP Helpers ───────────────────────────────────────────────────

/**
 * Upload a file via multipart/form-data to the locker API.
 * Streams the file and emits progress events.
 */
async function uploadToServer(
  filePath: string,
  filename: string,
  fileSize: number,
  tags: string[],
  entryId: string,
): Promise<UploadResult> {
  const token = await ensureValidToken();

  const apiBase = getApiBase();
  const url = `${apiBase}/locker/upload`;
  const parsedUrl = new URL(url);
  const transport = parsedUrl.protocol === "https:" ? https : http;

  // Build multipart form data manually to stream the file
  const boundary = `----BoilerDeckLocker${Date.now()}${Math.random().toString(36).slice(2)}`;
  const tagsJson = JSON.stringify(tags);

  // Build the parts before and after the file
  const preFileData =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="tags"\r\n\r\n` +
    `${tagsJson}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${detectMimeType(filename)}\r\n\r\n`;

  const postFileData = `\r\n--${boundary}--\r\n`;

  const preBuffer = Buffer.from(preFileData, "utf-8");
  const postBuffer = Buffer.from(postFileData, "utf-8");
  const contentLength = preBuffer.length + fileSize + postBuffer.length;

  return new Promise<UploadResult>((resolve, reject) => {
    const req = transport.request(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": contentLength,
      },
      timeout: 300_000, // 5 minutes for large files
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed as UploadResult);
          } catch {
            reject(new Error(`Invalid JSON response from server: ${body.slice(0, 200)}`));
          }
        } else {
          let message = `Upload failed (HTTP ${res.statusCode})`;
          try {
            const errorBody = JSON.parse(body);
            message = errorBody.error?.message || errorBody.message || message;
          } catch {
            // Use default message
          }
          reject(new Error(message));
        }
      });
      res.on("error", (err) => reject(new Error(`Response error: ${err.message}`)));
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Upload timed out after 5 minutes"));
    });

    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ECONNREFUSED") {
        reject(new Error("Server connection refused — is the server running?"));
      } else {
        reject(new Error(`Upload error: ${err.message}`));
      }
    });

    // Write multipart parts: pre-file header, file stream, post-file footer
    req.write(preBuffer);

    const fileStream = fs.createReadStream(filePath);
    let bytesUploaded = 0;

    fileStream.on("data", (chunk) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      req.write(buf);
      bytesUploaded += buf.length;
      emitProgress({
        entryId,
        percent: Math.round((bytesUploaded / fileSize) * 100),
        bytesUploaded,
        bytesTotal: fileSize,
      });
    });

    fileStream.on("end", () => {
      req.write(postBuffer);
      req.end();
    });

    fileStream.on("error", (err) => {
      req.destroy();
      reject(new Error(`File read error: ${err.message}`));
    });
  });
}

// ─── Token Refresh (main process) ────────────────────────────────

let refreshPromise: Promise<string | null> | null = null;

/**
 * Refresh the access token using the stored refresh token.
 * Serialized so concurrent callers share one in-flight request.
 */
async function refreshAccessTokenMainProcess(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefreshToken();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function doRefreshToken(): Promise<string | null> {
  const refreshToken = storeGet("refreshToken") as string | null;
  if (!refreshToken) return null;

  const apiBase = getApiBase();
  const url = `${apiBase}/auth/refresh`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      storeDelete("refreshToken");
      return null;
    }

    const data = await res.json() as { accessToken: string; refreshToken: string };
    storeSet("refreshToken", data.refreshToken);
    cachedAccessToken = data.accessToken;
    return data.accessToken;
  } catch {
    return null;
  }
}

/**
 * Make a JSON API request to the locker endpoints.
 * Automatically refreshes the access token on 401 and retries once.
 */
async function apiRequest<T>(
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<T> {
  const token = await ensureValidToken();

  const result = await rawApiRequest<T>(method, urlPath, body, token);

  // Auto-refresh on 401 and retry once
  if (result.statusCode === 401) {
    const newToken = await refreshAccessTokenMainProcess();
    if (newToken) {
      const retry = await rawApiRequest<T>(method, urlPath, body, newToken);
      if (retry.statusCode && retry.statusCode >= 200 && retry.statusCode < 300) {
        return retry.data as T;
      }
      throw new Error(retry.errorMessage ?? `API request failed (HTTP ${retry.statusCode})`);
    }
    throw new Error(result.errorMessage ?? "Invalid or expired token");
  }

  if (result.data !== undefined) return result.data;
  throw new Error(result.errorMessage ?? `API request failed (HTTP ${result.statusCode})`);
}

interface RawApiResult<T> {
  statusCode: number | undefined;
  data?: T;
  errorMessage?: string;
}

function rawApiRequest<T>(
  method: string,
  urlPath: string,
  body: unknown | undefined,
  token: string,
): Promise<RawApiResult<T>> {
  const apiBase = getApiBase();
  const url = `${apiBase}${urlPath}`;
  const parsedUrl = new URL(url);
  const transport = parsedUrl.protocol === "https:" ? https : http;

  return new Promise<RawApiResult<T>>((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
    };
    if (bodyStr) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(bodyStr));
    }

    const req = transport.request(url, {
      method,
      headers,
      timeout: 30_000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const responseBody = Buffer.concat(chunks).toString("utf-8");
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve({ statusCode: res.statusCode, data: JSON.parse(responseBody) as T });
          } catch {
            reject(new Error(`Invalid JSON response: ${responseBody.slice(0, 200)}`));
          }
        } else {
          let message = `API request failed (HTTP ${res.statusCode})`;
          try {
            const errorBody = JSON.parse(responseBody);
            message = errorBody.error?.message || errorBody.message || message;
          } catch {
            // Use default message
          }
          resolve({ statusCode: res.statusCode, errorMessage: message });
        }
      });
      res.on("error", (err) => reject(new Error(`Response error: ${err.message}`)));
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("API request timed out"));
    });

    req.on("error", (err) => {
      reject(new Error(`API error: ${err.message}`));
    });

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

// ─── ZIP Utility ────────────────────────────────────────────────────

/**
 * Create a zip file from a directory using Node.js built-in zlib.
 * Uses the `archiver` approach if available, otherwise falls back to
 * spawning a system zip command.
 *
 * For simplicity and no extra deps, we use a tar.gz approach via
 * Node.js built-in modules.
 */
async function zipDirectory(dirPath: string, outputPath: string): Promise<void> {
  // Use the archiver package if available, else fall back to system command
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const archiver = (await import("archiver" as any)).default as any;
    return new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver("zip", { zlib: { level: 6 } });

      output.on("close", () => resolve());
      archive.on("error", (err: Error) => reject(err));

      archive.pipe(output);
      archive.directory(dirPath, path.basename(dirPath));
      archive.finalize();
    });
  } catch {
    // Fallback: use spawn to call system zip/tar
    const { execFile } = await import("node:child_process");
    return new Promise<void>((resolve, reject) => {
      // Try PowerShell Compress-Archive on Windows
      if (process.platform === "win32") {
        execFile(
          "powershell",
          ["-NoProfile", "-Command",
           `Compress-Archive -Path '${dirPath}' -DestinationPath '${outputPath}' -Force`],
          (err) => {
            if (err) reject(new Error(`Failed to zip directory: ${err.message}`));
            else resolve();
          },
        );
      } else {
        execFile(
          "zip",
          ["-r", outputPath, "."],
          { cwd: dirPath },
          (err) => {
            if (err) reject(new Error(`Failed to zip directory: ${err.message}`));
            else resolve();
          },
        );
      }
    });
  }
}

// ─── Self-Custody Helpers ───────────────────────────────────────────

const ANNOUNCE_LIST = [
  ["udp://tracker.opentrackr.org:1337/announce"],
  ["udp://open.tracker.cl:1337/announce"],
  ["udp://open.demonii.com:1339/announce"],
  ["udp://open.stealth.si:80/announce"],
  ["udp://tracker.torrent.eu.org:451/announce"],
  ["udp://exodus.desync.com:6969/announce"],
  ["wss://tracker.openwebtorrent.com"],
  ["wss://tracker.webtorrent.dev"],
  ["wss://tracker.btorrent.xyz"],
];

/**
 * Create a torrent from a file using WebTorrent's seed capability.
 * Returns the torrent buffer, infoHash, and magnetUri.
 */
async function createTorrentFromFile(
  filePath: string,
  name: string,
): Promise<{ torrentBuffer: Buffer; infoHash: string; magnetUri: string }> {
  // WebTorrent includes create-torrent internally; we use its API.
  // However, we need the raw create-torrent for buffer-only creation.
  // Since WebTorrent is already a dep, it bundles create-torrent.
  // We'll use the webtorrent seed approach: seed the file, get the torrent data,
  // then destroy the client.
  const WT = (await import("webtorrent")).default;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tempClient: any = new WT();

  return new Promise<{ torrentBuffer: Buffer; infoHash: string; magnetUri: string }>((resolve, reject) => {
    let settled = false;

    const torrent: any = tempClient.seed(filePath, {
      name,
      comment: "BoilerDeck Data Locker",
      createdBy: "BoilerDeck",
      announceList: ANNOUNCE_LIST,
      private: false,
    });

    // Scale timeout by file size: 30s base + 30s per GB
    const timeoutMs = 30_000 + Math.ceil(fs.statSync(filePath).size / (1024 * 1024 * 1024)) * 30_000;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { tempClient.destroy(); } catch { /* ignore */ }
      reject(new Error(`Torrent creation timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    torrent.on("ready", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const torrentBuffer = torrent.torrentFile as Buffer;
        const infoHash = torrent.infoHash as string;
        const magnetUri = torrent.magnetURI as string;

        // Destroy the temp client — we don't need to keep seeding
        // (the main torrent client will handle that)
        torrent.destroy({ destroyStore: false }, () => {
          try { tempClient.destroy(); } catch { /* ignore */ }
        });

        resolve({ torrentBuffer, infoHash, magnetUri });
      } catch (err) {
        try { tempClient.destroy(); } catch { /* ignore */ }
        reject(err);
      }
    });

    torrent.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { tempClient.destroy(); } catch { /* ignore */ }
      reject(err);
    });
  });
}

/**
 * Upload raw file + .torrent to VPS for persistent seeding (self-custody path).
 * The server stores the file and adds it to Transmission without seeing metadata.
 */
async function uploadRawToVps(
  filePath: string,
  filename: string,
  fileSize: number,
  torrentBuffer: Buffer,
  entryId: string,
): Promise<void> {
  const token = await ensureValidToken();

  const apiBase = getApiBase();
  const url = `${apiBase}/locker/upload`;
  const parsedUrl = new URL(url);
  const transport = parsedUrl.protocol === "https:" ? https : http;

  // Build multipart form data with file, torrent file, and self_custody flag
  const boundary = `----BoilerDeckLockerSC${Date.now()}${Math.random().toString(36).slice(2)}`;

  // self_custody flag tells server to skip encryption/signing (already done locally)
  const preFileData =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="self_custody"\r\n\r\n` +
    `true\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="entry_id"\r\n\r\n` +
    `${entryId}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${detectMimeType(filename)}\r\n\r\n`;

  const midData =
    `\r\n--${boundary}\r\n` +
    `Content-Disposition: form-data; name="torrent"; filename="${entryId}.torrent"\r\n` +
    `Content-Type: application/x-bittorrent\r\n\r\n`;

  const postFileData = `\r\n--${boundary}--\r\n`;

  const preBuffer = Buffer.from(preFileData, "utf-8");
  const midBuffer = Buffer.from(midData, "utf-8");
  const postBuffer = Buffer.from(postFileData, "utf-8");
  const contentLength = preBuffer.length + fileSize + midBuffer.length + torrentBuffer.length + postBuffer.length;

  return new Promise<void>((resolve, reject) => {
    const req = transport.request(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": contentLength,
      },
      timeout: 300_000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          const body = Buffer.concat(chunks).toString("utf-8");
          let message = `VPS upload failed (HTTP ${res.statusCode})`;
          try {
            const errorBody = JSON.parse(body);
            message = errorBody.error?.message || errorBody.message || message;
          } catch {
            // Use default
          }
          // Non-fatal for self-custody — file is already published to relay
          console.warn(`[locker] VPS seed upload failed: ${message}`);
          resolve();
        }
      });
      res.on("error", (err) => {
        console.warn(`[locker] VPS seed upload error: ${err.message}`);
        resolve(); // Non-fatal
      });
    });

    req.on("timeout", () => {
      req.destroy();
      console.warn("[locker] VPS seed upload timed out");
      resolve(); // Non-fatal
    });

    req.on("error", (err) => {
      console.warn(`[locker] VPS seed upload error: ${err.message}`);
      resolve(); // Non-fatal
    });

    req.write(preBuffer);

    const fileStream = fs.createReadStream(filePath);
    let bytesUploaded = 0;

    fileStream.on("data", (chunk) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      req.write(buf);
      bytesUploaded += buf.length;
      emitProgress({
        entryId,
        percent: Math.round((bytesUploaded / fileSize) * 100),
        bytesUploaded,
        bytesTotal: fileSize,
      });
    });

    fileStream.on("end", () => {
      req.write(midBuffer);
      req.write(torrentBuffer);
      req.write(postBuffer);
      req.end();
    });

    fileStream.on("error", (err) => {
      req.destroy();
      console.warn(`[locker] File read error during VPS upload: ${err.message}`);
      resolve(); // Non-fatal
    });
  });
}

// ─── Exported Functions ─────────────────────────────────────────────

/**
 * Upload a file to the data locker.
 *
 * Opens a native file dialog, uploads the selected file.
 * Returns null if the user cancels the dialog.
 */
export async function uploadFile(tags: string[] = []): Promise<LockerEntry | null> {
  if (!mainWindowRef) {
    throw new Error("No main window available");
  }

  const result = await dialog.showOpenDialog(mainWindowRef, {
    properties: ["openFile"],
    title: "Select File to Upload to Locker",
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const filename = path.basename(filePath);
  const stat = await fsp.stat(filePath);
  const fileSize = stat.size;
  const entryId = crypto.randomUUID();

  // Check if this is a self-custody user
  const isSelfCustody = storeGet("custodyMode") === "SELF_CUSTODY";

  if (isSelfCustody) {
    return uploadFileSelfCustody(filePath, filename, fileSize, entryId, tags);
  }

  // ── Custodial path: upload to server API ──
  console.log(`[locker] Uploading file (custodial): ${filename} (${fileSize} bytes)`);

  try {
    const uploadResult = await uploadToServer(filePath, filename, fileSize, tags, entryId);

    serverOnline = true;

    // Build a LockerEntry from the server result + local file info
    const sha256 = await computeSha256(filePath);
    const mimeType = detectMimeType(filename);

    const entry: LockerEntry = {
      id: uploadResult.entryId,
      filename,
      size: fileSize,
      mimeType,
      sha256,
      infoHash: uploadResult.infoHash,
      magnetUri: "", // Server doesn't return magnetUri in upload response; will be in list
      createdAt: Math.floor(Date.now() / 1000),
      tags,
      version: 1,
    };

    // Save to local index as "downloaded" since the file exists locally
    lockerStore.upsertEntry({
      entryId: uploadResult.entryId,
      filename,
      size: fileSize,
      mimeType,
      sha256,
      infoHash: uploadResult.infoHash,
      magnetUri: "",
      tags,
      downloadStatus: "downloaded",
      localPath: filePath,
      lastSynced: Math.floor(Date.now() / 1000),
      createdAt: entry.createdAt,
      version: 1,
    });
    emitSyncUpdate(lockerStore.getAllEntries());

    console.log(`[locker] Upload complete: ${filename} → entryId=${uploadResult.entryId}`);
    return entry;
  } catch (err) {
    // Check if this is a network error (server unreachable)
    const msg = err instanceof Error ? err.message : String(err);
    if (isNetworkError(msg)) {
      serverOnline = false;
      console.warn(`[locker] Upload failed due to network error, queuing: ${filename}`);
      uploadQueue.addToQueue(filePath, tags, msg);
      throw new Error(`Upload queued — server unreachable. Will retry automatically.`);
    }
    throw err;
  }
}

/**
 * Self-custody upload: create torrent locally, encrypt, sign, publish to relay.
 */
async function uploadFileSelfCustody(
  filePath: string,
  filename: string,
  fileSize: number,
  entryId: string,
  tags: string[],
): Promise<LockerEntry> {
  console.log(`[locker] Uploading file (self-custody): ${filename} (${fileSize} bytes)`);

  // 1. Compute SHA-256
  const sha256 = await computeSha256(filePath);

  // 2. Detect MIME type
  const mimeType = detectMimeType(filename);

  // 3. Create torrent locally
  const { torrentBuffer, infoHash, magnetUri } = await createTorrentFromFile(filePath, filename);

  // 4. Build LockerEntry
  const lockerEntry: LockerEntry = {
    id: entryId,
    filename,
    size: fileSize,
    mimeType,
    sha256,
    infoHash,
    magnetUri,
    createdAt: Math.floor(Date.now() / 1000),
    tags,
    version: 1,
  };

  // 5. Get local key for encryption and signing
  const pubkeyHex = await keyManager.getPublicKey();
  if (!pubkeyHex) {
    throw new Error("No local key available for self-custody upload");
  }
  const privkeyHex = keyManager.getPrivateKeyHex();

  // 6. Encrypt with NIP-44 (to own pubkey)
  const plaintext = JSON.stringify(lockerEntry);
  const encrypted = await nip44Encrypt(plaintext, privkeyHex, pubkeyHex);

  // 7. Build event tags
  const eventTags: string[][] = [["d", entryId]];
  for (const tag of tags) {
    eventTags.push(["t", tag]);
  }

  // 7b. Optionally add peer hints
  const settings = lockerSettings.getSettings();
  if (settings.includePeerHints) {
    lockerEntry.peerHints = []; // Placeholder — actual IP discovery would go here
  }

  // 8. Sign event locally
  const signedEvent = await keyManager.signEvent(encrypted, 30078, eventTags);

  // 9. Save to local index immediately so it appears in the UI
  lockerStore.upsertEntry({
    entryId,
    filename,
    size: fileSize,
    mimeType,
    sha256,
    infoHash,
    magnetUri,
    tags,
    downloadStatus: "downloaded",
    localPath: filePath,
    lastSynced: Math.floor(Date.now() / 1000),
    createdAt: lockerEntry.createdAt,
    version: 1,
  });
  emitSyncUpdate(lockerStore.getAllEntries());

  // 10. Publish to all configured relays (primary + additional)
  const anyPublished = await publishToAllRelays(signedEvent);
  if (!anyPublished) {
    console.warn("[locker] Failed to publish to any relay. Event still created locally.");
  }

  // 11. Upload raw file + .torrent to VPS for persistent seeding (non-fatal)
  uploadRawToVps(filePath, filename, fileSize, torrentBuffer, entryId).catch((err) => {
    console.warn("[locker] VPS seed upload failed (non-fatal):", err);
  });

  console.log(`[locker] Self-custody upload complete: ${filename} → entryId=${entryId}`);
  return lockerEntry;
}

/**
 * Upload a directory to the data locker.
 *
 * Opens a native directory picker, zips the contents, uploads the zip.
 * Returns null if the user cancels the dialog.
 */
export async function uploadDirectory(tags: string[] = []): Promise<LockerEntry | null> {
  if (!mainWindowRef) {
    throw new Error("No main window available");
  }

  const result = await dialog.showOpenDialog(mainWindowRef, {
    properties: ["openDirectory"],
    title: "Select Directory to Upload to Locker",
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const dirPath = result.filePaths[0];
  const dirName = path.basename(dirPath);
  const zipFilename = `${dirName}.zip`;

  // Create a temp zip file
  const { app } = await import("electron");
  const tempDir = app.getPath("temp");
  const zipPath = path.join(tempDir, `locker-${Date.now()}-${zipFilename}`);

  console.log(`[locker] Zipping directory: ${dirPath} → ${zipPath}`);

  try {
    await zipDirectory(dirPath, zipPath);

    const stat = await fsp.stat(zipPath);
    const fileSize = stat.size;
    const entryId = crypto.randomUUID();

    // Check if this is a self-custody user
    const isSelfCustody = storeGet("custodyMode") === "SELF_CUSTODY";

    let entry: LockerEntry | null;
    if (isSelfCustody) {
      entry = await uploadFileSelfCustody(zipPath, zipFilename, fileSize, entryId, tags);
    } else {
      console.log(`[locker] Uploading directory as zip (custodial): ${zipFilename} (${fileSize} bytes)`);

      const uploadResult = await uploadToServer(zipPath, zipFilename, fileSize, tags, entryId);
      const sha256 = await computeSha256(zipPath);

      entry = {
        id: uploadResult.entryId,
        filename: zipFilename,
        size: fileSize,
        mimeType: "application/zip",
        sha256,
        infoHash: uploadResult.infoHash,
        magnetUri: "",
        createdAt: Math.floor(Date.now() / 1000),
        tags,
        version: 1,
      };
    }

    return entry;
  } finally {
    // Clean up temp zip file
    try {
      await fsp.unlink(zipPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Fetch all locker entries for the current user.
 *
 * Local-first: returns cached local entries immediately merged with server data.
 * If the server is unreachable, returns cached entries with the last known quota.
 * Updates lastSynced timestamp on successful server fetch.
 */
export async function getEntries(): Promise<ListResult> {
  try {
    const result = await apiRequest<ListResult>("GET", "/locker/entries");
    serverOnline = true;
    lockerStore.setLastSynced(Date.now());

    // Update local index with server entries
    for (const entry of result.entries) {
      const existing = lockerStore.getEntry(entry.id);
      lockerStore.upsertEntry({
        entryId: entry.id,
        filename: entry.filename,
        size: entry.size,
        mimeType: entry.mimeType,
        sha256: entry.sha256,
        infoHash: entry.infoHash,
        magnetUri: entry.magnetUri,
        tags: entry.tags,
        downloadStatus: existing?.downloadStatus || "available",
        localPath: existing?.localPath || null,
        lastSynced: Math.floor(Date.now() / 1000),
        createdAt: entry.createdAt,
        version: entry.version,
      });
    }

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isNetworkError(msg)) {
      serverOnline = false;
      console.warn("[locker] Server unreachable, returning cached entries");

      // Return cached entries from local index
      const cachedEntries = lockerStore.getAllEntries();
      return {
        entries: cachedEntries.map((e) => ({
          id: e.entryId,
          filename: e.filename,
          size: e.size,
          mimeType: e.mimeType,
          sha256: e.sha256,
          infoHash: e.infoHash,
          magnetUri: e.magnetUri,
          createdAt: e.createdAt,
          tags: e.tags,
          version: e.version,
        })),
        quota: { used: 0, max: 50 * 1024 * 1024 * 1024 }, // Default when offline
      };
    }
    throw err;
  }
}

/**
 * Delete a locker entry by its entry ID.
 */
export async function deleteEntry(entryId: string): Promise<void> {
  await apiRequest<{ success: true }>("DELETE", `/locker/entries/${entryId}`);
}

/**
 * Download a locker entry to a local path using WebTorrent.
 *
 * Enhanced flow:
 * 1. Look up entry in local index (or fetch from server)
 * 2. Update status to 'downloading'
 * 3. Download via WebTorrent using magnetUri or .torrent file
 * 4. Send progress events to renderer
 * 5. Verify SHA-256 after download
 * 6. Update local index status → 'downloaded' with localPath
 * 7. If seed-after-download setting is on, keep seeding
 *
 * Returns the local file path of the downloaded file.
 */
export async function downloadEntry(
  entryId: string,
  downloadPath?: string,
): Promise<string> {
  const token = await ensureValidToken();

  // Determine download path from settings if not provided
  const settings = lockerSettings.getSettings();
  const effectiveDownloadPath = downloadPath || path.join(settings.downloadPath, entryId);

  // Look up entry in local index
  let localEntry = lockerStore.getEntry(entryId);

  // Update status to downloading
  if (localEntry) {
    lockerStore.setDownloadStatus(entryId, "downloading");
  }

  // First, get the .torrent file from the server
  const apiBase = getApiBase();
  const torrentUrl = `${apiBase}/locker/entries/${entryId}/torrent`;
  const parsedUrl = new URL(torrentUrl);
  const transport = parsedUrl.protocol === "https:" ? https : http;

  let torrentBuffer: Buffer;
  try {
    torrentBuffer = await new Promise<Buffer>((resolve, reject) => {
      const req = transport.request(torrentUrl, {
        method: "GET",
        headers: { "Authorization": `Bearer ${token}` },
        timeout: 30_000,
      }, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => resolve(Buffer.concat(chunks)));
          res.on("error", (err) => reject(new Error(`Response error: ${err.message}`)));
        } else {
          res.resume();
          reject(new Error(`Failed to fetch torrent file (HTTP ${res.statusCode})`));
        }
      });

      req.on("timeout", () => { req.destroy(); reject(new Error("Torrent fetch timed out")); });
      req.on("error", (err) => reject(new Error(`Torrent fetch error: ${err.message}`)));
      req.end();
    });
  } catch (err) {
    lockerStore.setDownloadStatus(entryId, "error");
    throw err;
  }

  // Ensure download directory exists
  await fsp.mkdir(effectiveDownloadPath, { recursive: true });

  // Download via WebTorrent
  const WT = (await import("webtorrent")).default;
  const tempClient = new WT();

  return new Promise<string>((resolve, reject) => {
    const torrent = tempClient.add(torrentBuffer, { path: effectiveDownloadPath });

    // Add VPS as direct peer since tracker discovery is unreliable
    torrent.on("infoHash", () => {
      console.log(`[locker:dl] Adding VPS peer 204.168.133.38:6881`);
      (torrent as any).addPeer("204.168.133.38:6881");
    });

    torrent.on("error", (err: Error) => {
      tempClient.destroy();
      lockerStore.setDownloadStatus(entryId, "error");
      reject(new Error(`Torrent download error: ${err.message}`));
    });

    // Debug: log tracker and peer events
    const t = torrent as any;
    t.on("ready", () => {
      console.log(`[locker:dl] Torrent ready: ${entryId}, files: ${t.files?.length}, length: ${t.length}`);
      console.log(`[locker:dl] InfoHash: ${t.infoHash}`);
    });
    t.on("wire", (wire: any) => {
      console.log(`[locker:dl] Connected to peer: ${wire.remoteAddress}:${wire.remotePort}`);
    });
    t.on("noPeers", (announceType: string) => {
      console.log(`[locker:dl] No peers from ${announceType} for ${entryId}`);
    });
    t.on("warning", (warn: any) => {
      console.log(`[locker:dl] Warning: ${warn}`);
    });

    // Progress updates
    const progressInterval = setInterval(() => {
      if (torrent.progress !== undefined) {
        const bytesDownloaded = torrent.downloaded || 0;
        const bytesTotal = torrent.length || 0;
        console.log(`[locker:dl] Progress: ${entryId} ${Math.round(torrent.progress * 100)}% peers=${torrent.numPeers || 0}`);
        emitDownloadProgress({
          entryId,
          percent: Math.round(torrent.progress * 100),
          bytesDownloaded,
          bytesTotal,
        });
      }
    }, 1000);

    torrent.on("done", async () => {
      clearInterval(progressInterval);

      // Send 100% progress
      emitDownloadProgress({
        entryId,
        percent: 100,
        bytesDownloaded: torrent.length || 0,
        bytesTotal: torrent.length || 0,
      });

      console.log(`[locker] Download complete: entryId=${entryId}`);

      // Get the path to the first file
      const firstFile = torrent.files[0];
      const localPath = path.join(effectiveDownloadPath, firstFile?.path || "");

      // Verify SHA-256 if we have the expected hash
      localEntry = lockerStore.getEntry(entryId);
      if (localEntry?.sha256) {
        try {
          const actualHash = await computeSha256(localPath);
          if (actualHash !== localEntry.sha256) {
            console.warn(`[locker] SHA-256 mismatch for ${entryId}: expected=${localEntry.sha256}, actual=${actualHash}`);
            lockerStore.setDownloadStatus(entryId, "error");
            torrent.destroy({ destroyStore: false }, () => tempClient.destroy());
            reject(new Error(`SHA-256 verification failed for entry ${entryId}`));
            return;
          }
          console.log(`[locker] SHA-256 verified for ${entryId}`);
        } catch (err) {
          console.warn(`[locker] SHA-256 verification error for ${entryId}:`, err);
          // Non-fatal — still mark as downloaded
        }
      }

      // Update local index status
      lockerStore.setDownloadStatus(entryId, "downloaded", localPath);

      // Check if we should keep seeding
      const currentSettings = lockerSettings.getSettings();
      if (currentSettings.seedAfterDownload) {
        lockerStore.setDownloadStatus(entryId, "seeding", localPath);
        // Keep the torrent alive for seeding — don't destroy
        console.log(`[locker] Seeding after download: ${entryId}`);
        resolve(localPath);
      } else {
        // Release file handles
        torrent.destroy({ destroyStore: false }, () => {
          tempClient.destroy();
        });
        resolve(localPath);
      }
    });

    // Timeout after 10 minutes
    setTimeout(() => {
      clearInterval(progressInterval);
      tempClient.destroy();
      lockerStore.setDownloadStatus(entryId, "error");
      reject(new Error("Download timed out after 10 minutes"));
    }, 600_000);
  });
}

// ─── Relay Sync ─────────────────────────────────────────────────────

/**
 * Get the private key for NIP-44 decryption.
 * Uses cached relay key first, falls back to self-custody key.
 */
function getDecryptionPrivkey(): string | null {
  const relayPrivkey = storeGet("relayPrivkey") as string | null;
  if (relayPrivkey) return relayPrivkey;
  try {
    return keyManager.getPrivateKeyHex();
  } catch {
    return null;
  }
}

/**
 * Get the pubkey for the current user.
 * Uses cached relay pubkey first, falls back to self-custody.
 */
async function getUserPubkey(): Promise<string | null> {
  const relayPubkey = storeGet("relayPubkey") as string | null;
  if (relayPubkey) return relayPubkey;
  return keyManager.getPublicKey();
}

/**
 * Process a relay event: decrypt, parse, and update local index.
 */
async function processLockerEvent(event: {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}): Promise<LockerIndexEntry | null> {
  if (event.kind !== 30078) return null;

  const privkey = getDecryptionPrivkey();
  if (!privkey) {
    console.warn("[locker-sync] No private key available for decryption");
    return null;
  }

  try {
    const plaintext = await nip44Decrypt(event.content, privkey, event.pubkey);
    const lockerEntry = JSON.parse(plaintext) as LockerEntry;

    // Get the d-tag (entryId)
    const dTag = event.tags.find((t) => t[0] === "d");
    const entryId = dTag?.[1] || lockerEntry.id;

    // Check if we already have this entry
    const existing = lockerStore.getEntry(entryId);

    const indexEntry: LockerIndexEntry = {
      entryId,
      filename: lockerEntry.filename,
      size: lockerEntry.size,
      mimeType: lockerEntry.mimeType,
      sha256: lockerEntry.sha256,
      infoHash: lockerEntry.infoHash,
      magnetUri: lockerEntry.magnetUri,
      tags: lockerEntry.tags,
      downloadStatus: existing?.downloadStatus || "available",
      localPath: existing?.localPath || null,
      lastSynced: Math.floor(Date.now() / 1000),
      createdAt: lockerEntry.createdAt,
      version: lockerEntry.version,
    };

    lockerStore.upsertEntry(indexEntry);
    return indexEntry;
  } catch (err) {
    console.warn("[locker-sync] Failed to process event:", err);
    return null;
  }
}

/**
 * Process a delete event (kind 5 — NIP-09).
 */
function processDeleteEvent(event: {
  kind: number;
  tags: string[][];
}): string | null {
  if (event.kind !== 5) return null;

  // NIP-09: e tags reference the events to delete
  for (const tag of event.tags) {
    if (tag[0] === "e") {
      // We can't easily map event IDs to entry IDs without querying relay.
      // Instead, look for a tags referencing entries.
    }
    if (tag[0] === "a") {
      // Addressable event reference: "30078:<pubkey>:<d-tag>"
      const parts = tag[1]?.split(":");
      if (parts && parts.length >= 3 && parts[0] === "30078") {
        const entryId = parts[2];
        lockerStore.removeEntry(entryId);
        return entryId;
      }
    }
  }

  return null;
}

/**
 * Create the WebSocket connection for locker sync.
 */
function createSyncConnection(): void {
  if (!syncUserPubkey) return;

  console.log("[locker-sync] Connecting to relay for locker sync...");

  syncWs = new WebSocket(RELAY_URL);
  syncSubId = `locker-sync-${Date.now()}`;

  syncWs.on("open", () => {
    console.log("[locker-sync] Connected to relay");
    syncReconnectAttempts = 0;
    relayConnected = true;

    // Subscribe for kind 30078 events authored by the user
    const reqMsg = JSON.stringify([
      "REQ",
      syncSubId,
      { kinds: [30078], authors: [syncUserPubkey] },
    ]);
    syncWs!.send(reqMsg);

    // Also subscribe for kind 5 (delete) events authored by the user
    const deleteSubId = `locker-sync-delete-${Date.now()}`;
    const deleteReqMsg = JSON.stringify([
      "REQ",
      deleteSubId,
      { kinds: [5], authors: [syncUserPubkey] },
    ]);
    syncWs!.send(deleteReqMsg);
  });

  syncWs.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (!Array.isArray(msg) || msg.length < 1) return;

      const type = msg[0];

      if (type === "EVENT" && msg.length >= 3) {
        const event = msg[2] as {
          id: string;
          pubkey: string;
          created_at: number;
          kind: number;
          tags: string[][];
          content: string;
        };

        if (event.kind === 30078) {
          const entry = await processLockerEvent(event);
          if (entry) {
            emitSyncUpdate([entry]);

            // Auto-download if enabled
            const settings = lockerSettings.getSettings();
            if (settings.autoDownload && entry.downloadStatus === "available") {
              console.log(`[locker-sync] Auto-downloading: ${entry.filename}`);
              downloadEntry(entry.entryId).catch((err) => {
                console.warn(`[locker-sync] Auto-download failed for ${entry.entryId}:`, err);
              });
            }
          }
        } else if (event.kind === 5) {
          const deletedEntryId = processDeleteEvent(event);
          if (deletedEntryId) {
            emitSyncUpdate(lockerStore.getAllEntries());
          }
        }
      } else if (type === "EOSE") {
        console.log("[locker-sync] Initial sync complete (EOSE)");
        lockerStore.setLastSynced(Date.now());
        // Notify renderer that sync is up to date
        emitSyncUpdate(lockerStore.getAllEntries());
      }
    } catch {
      // Ignore unparseable messages
    }
  });

  syncWs.on("close", () => {
    console.log("[locker-sync] Connection closed");
    syncWs = null;
    relayConnected = false;

    if (!syncIntentionalClose && syncUserPubkey) {
      scheduleSyncReconnect();
    }
  });

  syncWs.on("error", (err) => {
    console.error("[locker-sync] WebSocket error:", err.message);
    // close event will fire after error, triggering reconnect
  });
}

function scheduleSyncReconnect(): void {
  if (syncReconnectTimer) return;

  const delay = Math.min(
    BASE_SYNC_RECONNECT_DELAY * Math.pow(2, syncReconnectAttempts),
    MAX_SYNC_RECONNECT_DELAY,
  );
  syncReconnectAttempts++;

  console.log(`[locker-sync] Reconnecting in ${delay}ms (attempt ${syncReconnectAttempts})`);

  syncReconnectTimer = setTimeout(() => {
    syncReconnectTimer = null;
    createSyncConnection();
  }, delay);
}

// Additional relay connections for multi-relay sync
const additionalRelayWs: WebSocket[] = [];

/**
 * Subscribe to locker events on an additional relay.
 * Events are processed the same way as on the primary relay.
 */
function subscribeOnAdditionalRelay(relayUrl: string, pubkey: string): void {
  try {
    const ws = new WebSocket(relayUrl);
    additionalRelayWs.push(ws);

    ws.on("open", () => {
      console.log(`[locker-sync] Connected to additional relay: ${relayUrl}`);
      const subId = `locker-additional-${Date.now()}`;
      ws.send(JSON.stringify(["REQ", subId, { kinds: [30078], authors: [pubkey] }]));
    });

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (!Array.isArray(msg) || msg.length < 1) return;

        if (msg[0] === "EVENT" && msg.length >= 3) {
          const event = msg[2] as {
            id: string;
            pubkey: string;
            created_at: number;
            kind: number;
            tags: string[][];
            content: string;
          };
          if (event.kind === 30078) {
            const entry = await processLockerEvent(event);
            if (entry) {
              emitSyncUpdate([entry]);
            }
          }
        }
      } catch {
        // Ignore
      }
    });

    ws.on("error", (err) => {
      console.warn(`[locker-sync] Additional relay error (${relayUrl}):`, err.message);
    });

    ws.on("close", () => {
      const idx = additionalRelayWs.indexOf(ws);
      if (idx >= 0) additionalRelayWs.splice(idx, 1);
    });
  } catch (err) {
    console.warn(`[locker-sync] Failed to connect to additional relay ${relayUrl}:`, err);
  }
}

/**
 * Start the locker sync subscription.
 * Subscribes to the relay for kind 30078 events authored by the user.
 * Reconnects on disconnect with exponential backoff.
 */
export async function startLockerSync(): Promise<void> {
  // Stop any existing sync first (prevents double connections from StrictMode)
  stopLockerSync();

  // Get the user's pubkey
  const pubkey = await getUserPubkey();
  if (!pubkey) {
    console.warn("[locker-sync] No pubkey available, cannot start sync");
    return;
  }

  syncUserPubkey = pubkey;
  syncIntentionalClose = false;
  syncReconnectAttempts = 0;

  // Load local index
  lockerStore.loadIndex();

  // Load settings
  lockerSettings.loadSettings();

  // Initialize upload queue
  initUploadQueue();

  // Connect to relay
  createSyncConnection();

  // Also subscribe on additional relays for redundancy
  const additionalRelays = lockerSettings.getAdditionalRelays();
  for (const relayUrl of additionalRelays) {
    subscribeOnAdditionalRelay(relayUrl, pubkey);
  }

  // Start periodic polling (every 5 minutes)
  if (syncPollTimer) {
    clearInterval(syncPollTimer);
  }
  syncPollTimer = setInterval(() => {
    // Re-subscribe to get any missed events
    if (syncWs && syncWs.readyState === WebSocket.OPEN && syncSubId) {
      // Close old subscription and create new one to get fresh data
      syncWs.send(JSON.stringify(["CLOSE", syncSubId]));
      syncSubId = `locker-sync-${Date.now()}`;
      syncWs.send(JSON.stringify([
        "REQ",
        syncSubId,
        { kinds: [30078], authors: [syncUserPubkey] },
      ]));
      console.log("[locker-sync] Periodic re-sync triggered");
    }
  }, SYNC_INTERVAL_MS);

  console.log("[locker-sync] Sync started for pubkey:", pubkey.slice(0, 8) + "...");
}

/**
 * Stop the locker sync subscription and clean up.
 */
export function stopLockerSync(): void {
  syncIntentionalClose = true;

  if (syncPollTimer) {
    clearInterval(syncPollTimer);
    syncPollTimer = null;
  }

  if (syncReconnectTimer) {
    clearTimeout(syncReconnectTimer);
    syncReconnectTimer = null;
  }

  if (syncWs) {
    try {
      if (syncSubId && syncWs.readyState === WebSocket.OPEN) {
        syncWs.send(JSON.stringify(["CLOSE", syncSubId]));
      }
      syncWs.close();
    } catch {
      // Ignore errors closing a CONNECTING socket
    }
    syncWs = null;
  }

  // Close additional relay connections
  for (const ws of additionalRelayWs) {
    try { ws.close(); } catch { /* ignore */ }
  }
  additionalRelayWs.length = 0;

  // Stop upload queue processing
  stopUploadQueue();

  syncSubId = null;
  syncUserPubkey = null;
  syncReconnectAttempts = 0;
  relayConnected = false;

  console.log("[locker-sync] Sync stopped");
}

/**
 * Get all entries from the local index (fast, no network).
 */
export function getLocalEntries(): LockerIndexEntry[] {
  return lockerStore.getAllEntries();
}

/**
 * Get locker settings.
 */
export function getLockerSettings(): lockerSettings.LockerSettings {
  return lockerSettings.getSettings();
}

/**
 * Set auto-download preference.
 */
export function setAutoDownload(enabled: boolean): void {
  lockerSettings.setAutoDownload(enabled);
}

/**
 * Set the download path.
 */
export function setDownloadPath(newPath: string): void {
  lockerSettings.setDownloadPath(newPath);
}

/**
 * Open a downloaded file in the OS default application.
 */
export async function openFile(filePath: string): Promise<string> {
  return shell.openPath(filePath);
}

/**
 * Show a file in the OS file explorer.
 */
export function showInFolder(filePath: string): void {
  shell.showItemInFolder(filePath);
}

// ─── Sharing ─────────────────────────────────────────────────────────

export interface ShareResult {
  shareId: string;
  eventId: string;
}

export interface SharedWithMeResult {
  entries: LockerEntry[];
  sharedFrom: Record<string, string>; // entryId -> senderPubkey
}

/**
 * Share a locker entry with another user by their pubkey.
 */
export async function shareEntry(
  entryId: string,
  recipientPubkey: string,
): Promise<ShareResult> {
  return apiRequest<ShareResult>("POST", "/locker/share", {
    entryId,
    recipientPubkey,
  });
}

/**
 * Get locker entries shared with the current user.
 */
export async function getSharedWithMe(): Promise<SharedWithMeResult> {
  return apiRequest<SharedWithMeResult>("GET", "/locker/shared-with-me");
}

/**
 * Revoke a previously shared locker entry.
 */
export async function revokeShare(shareId: string): Promise<void> {
  await apiRequest<{ success: true }>("DELETE", `/locker/share/${shareId}`);
}

// ─── Offline Upload Queue ───────────────────────────────────────────

/**
 * Initialize the upload queue. Call on app startup.
 */
export function initUploadQueue(): void {
  uploadQueue.loadQueue();

  // Start processing with a retry function that attempts upload via server
  uploadQueue.startProcessing(async (filePath: string, tags: string[]) => {
    const filename = path.basename(filePath);
    const stat = await fsp.stat(filePath);
    const fileSize = stat.size;
    const entryId = crypto.randomUUID();
    await uploadToServer(filePath, filename, fileSize, tags, entryId);
  });
}

/**
 * Stop the upload queue processing.
 */
export function stopUploadQueue(): void {
  uploadQueue.stopProcessing();
}

/**
 * Get queued upload items.
 */
export function getUploadQueue(): uploadQueue.QueueItem[] {
  return uploadQueue.getQueue();
}

/**
 * Manually trigger queue processing.
 */
export async function retryQueue(): Promise<{ processed: number }> {
  const count = await uploadQueue.processQueue(async (filePath: string, tags: string[]) => {
    const filename = path.basename(filePath);
    const stat = await fsp.stat(filePath);
    const fileSize = stat.size;
    const entryId = crypto.randomUUID();
    await uploadToServer(filePath, filename, fileSize, tags, entryId);
  });
  return { processed: count };
}

/**
 * Remove a specific item from the upload queue.
 */
export function clearQueueItem(id: string): void {
  uploadQueue.removeFromQueue(id);
}

// ─── Connection Status ──────────────────────────────────────────────

/**
 * Get the current connection status.
 */
export function getConnectionStatus(): ConnectionStatus {
  return {
    serverOnline,
    relayConnected,
    lastSynced: lockerStore.getLastSynced(),
    uploadQueueCount: uploadQueue.getPendingCount(),
  };
}

/**
 * Check if the server is reachable (quick health check).
 */
async function checkServerOnline(): Promise<boolean> {
  try {
    await apiRequest<unknown>("GET", "/locker/health");
    serverOnline = true;
    return true;
  } catch {
    serverOnline = false;
    return false;
  }
}

// ─── Multi-Relay Publish ────────────────────────────────────────────

/**
 * Publish an event to all configured relays (primary + additional).
 * Returns true if at least one relay accepted the event.
 */
async function publishToAllRelays(signedEvent: RelayEvent): Promise<boolean> {
  let anySuccess = false;

  // Try primary relay via relayManager
  const primaryResult = relayManager.publish(signedEvent);
  if (primaryResult.success) {
    anySuccess = true;
  } else {
    console.warn(`[locker] Primary relay publish failed: ${primaryResult.error}`);
  }

  // Try additional relays
  const additionalRelays = lockerSettings.getAdditionalRelays();
  for (const relayUrl of additionalRelays) {
    try {
      await publishToRelay(relayUrl, signedEvent);
      anySuccess = true;
    } catch (err) {
      console.warn(`[locker] Additional relay publish failed (${relayUrl}):`, err);
    }
  }

  return anySuccess;
}

/**
 * Publish an event to a specific relay via a temporary WebSocket.
 */
function publishToRelay(relayUrl: string, event: unknown): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(relayUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Publish to ${relayUrl} timed out`));
    }, 10_000);

    ws.on("open", () => {
      ws.send(JSON.stringify(["EVENT", event]));
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (Array.isArray(msg) && msg[0] === "OK") {
          clearTimeout(timeout);
          ws.close();
          if (msg[2] === true) {
            resolve();
          } else {
            reject(new Error(msg[3] || "Relay rejected event"));
          }
        }
      } catch {
        // Ignore unparseable messages
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      ws.close();
      reject(err);
    });

    ws.on("close", () => {
      clearTimeout(timeout);
    });
  });
}

// ─── Data Export ────────────────────────────────────────────────────

/**
 * Export the full local locker index as a JSON file.
 * Opens a save dialog for the user to choose where to save.
 */
export async function exportIndex(): Promise<{ success: boolean; path?: string }> {
  if (!mainWindowRef) {
    throw new Error("No main window available");
  }

  const entries = lockerStore.getAllEntries();

  const result = await dialog.showSaveDialog(mainWindowRef, {
    title: "Export Locker Index",
    defaultPath: `locker-index-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [
      { name: "JSON Files", extensions: ["json"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (result.canceled || !result.filePath) {
    return { success: false };
  }

  const exportData = {
    exportedAt: new Date().toISOString(),
    entryCount: entries.length,
    entries: entries.map((e) => ({
      entryId: e.entryId,
      filename: e.filename,
      size: e.size,
      mimeType: e.mimeType,
      sha256: e.sha256,
      infoHash: e.infoHash,
      magnetUri: e.magnetUri,
      tags: e.tags,
      createdAt: e.createdAt,
      version: e.version,
      downloadStatus: e.downloadStatus,
      localPath: e.localPath,
    })),
  };

  await fsp.writeFile(result.filePath, JSON.stringify(exportData, null, 2), "utf-8");
  console.log(`[locker] Exported index to ${result.filePath}`);
  return { success: true, path: result.filePath };
}

// ─── Additional Relays Setting ──────────────────────────────────────

/**
 * Set additional relays for multi-relay publishing.
 */
export function setAdditionalRelays(relays: string[]): void {
  lockerSettings.setAdditionalRelays(relays);
}
