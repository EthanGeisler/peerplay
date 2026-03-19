/**
 * Locker REST routes — upload, list, delete, sharing, and torrent retrieval.
 *
 * All routes are authenticated (JWT middleware).
 *
 * Routes:
 * - POST /upload — multipart file upload to locker
 * - GET /entries — list user's locker entries (decrypted)
 * - DELETE /entries/:entryId — delete a locker entry (NIP-09)
 * - GET /entries/:entryId/torrent — download .torrent file
 * - POST /share — share an entry with another user
 * - GET /shared-with-me — get entries shared with current user
 * - DELETE /share/:shareId — revoke a shared entry
 * - GET /health — public health check (Transmission + storage stats)
 */

import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { authenticate, ValidationError } from "@boilerdeck/shared";
import { getLockerConfig } from "./config.js";
import * as lockerService from "./service.js";
import * as seedManager from "./seedManager.js";

export const lockerRouter = Router();

// ─── Multer config ──────────────────────────────────────────────────

const lockerUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const config = getLockerConfig();
      const tmpDir = path.join(config.LOCKER_DIR, ".tmp");
      fs.mkdirSync(tmpDir, { recursive: true });
      cb(null, tmpDir);
    },
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}-${file.originalname}`);
    },
  }),
  limits: {
    fileSize: getLockerConfig().LOCKER_MAX_FILE_SIZE,
  },
});

// ─── POST /upload ───────────────────────────────────────────────────

lockerRouter.post(
  "/upload",
  authenticate,
  lockerUpload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new ValidationError("No file provided");
      }

      // Parse optional tags from body
      let tags: string[] = [];
      if (req.body.tags) {
        try {
          tags = typeof req.body.tags === "string"
            ? JSON.parse(req.body.tags)
            : req.body.tags;
          if (!Array.isArray(tags) || !tags.every((t: unknown) => typeof t === "string")) {
            throw new Error();
          }
        } catch {
          throw new ValidationError("tags must be a JSON array of strings");
        }
      }

      const result = await lockerService.uploadFile(
        req.user!.sub,
        req.file.path,
        req.file.originalname,
        req.file.size,
        tags,
      );

      res.status(201).json(result);
    } catch (err) {
      // Clean up temp file on error
      if (req.file?.path) {
        fs.unlink(req.file.path, () => {});
      }
      next(err);
    }
  },
);

// ─── GET /entries ───────────────────────────────────────────────────

lockerRouter.get(
  "/entries",
  authenticate,
  async (req, res, next) => {
    try {
      const result = await lockerService.listEntries(req.user!.sub);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── DELETE /entries/:entryId ───────────────────────────────────────

lockerRouter.delete(
  "/entries/:entryId",
  authenticate,
  async (req, res, next) => {
    try {
      const entryId = req.params.entryId as string;
      const result = await lockerService.deleteEntry(
        req.user!.sub,
        entryId,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /entries/:entryId/torrent ──────────────────────────────────

lockerRouter.get(
  "/entries/:entryId/torrent",
  authenticate,
  async (req, res, next) => {
    try {
      const entryId = req.params.entryId as string;
      const torrentBuffer = await lockerService.getTorrentFile(
        req.user!.sub,
        entryId,
      );

      res.setHeader("Content-Type", "application/x-bittorrent");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${entryId}.torrent"`,
      );
      res.send(torrentBuffer);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /share ────────────────────────────────────────────────────

lockerRouter.post(
  "/share",
  authenticate,
  async (req, res, next) => {
    try {
      const { entryId, recipientPubkey } = req.body as {
        entryId?: string;
        recipientPubkey?: string;
      };

      if (!entryId || typeof entryId !== "string") {
        throw new ValidationError("entryId is required");
      }
      if (
        !recipientPubkey ||
        typeof recipientPubkey !== "string" ||
        recipientPubkey.length !== 64 ||
        !/^[0-9a-f]{64}$/i.test(recipientPubkey)
      ) {
        throw new ValidationError(
          "recipientPubkey must be a 64-char hex public key",
        );
      }

      const result = await lockerService.shareEntry(
        req.user!.sub,
        entryId,
        recipientPubkey,
      );

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /shared-with-me ────────────────────────────────────────────

lockerRouter.get(
  "/shared-with-me",
  authenticate,
  async (req, res, next) => {
    try {
      const result = await lockerService.getSharedWithMe(req.user!.sub);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── DELETE /share/:shareId ─────────────────────────────────────────

lockerRouter.delete(
  "/share/:shareId",
  authenticate,
  async (req, res, next) => {
    try {
      const shareId = req.params.shareId as string;
      const result = await lockerService.revokeShare(req.user!.sub, shareId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /health ─────────────────────────────────────────────────────

/**
 * Public health check endpoint — no auth required.
 * Reports Transmission connection status, storage stats, and torrent counts.
 * No sensitive data exposed (no user info, no file paths).
 */
lockerRouter.get(
  "/health",
  async (_req, res, next) => {
    try {
      let transmissionOk = false;
      let torrentStats: { active: number; paused: number; total: number; totalSize: number } | null = null;

      try {
        torrentStats = await seedManager.getLockerTorrentStats();
        transmissionOk = true;
      } catch {
        // Transmission not reachable — report as unhealthy
      }

      let storageStats: { totalBytes: number; lockerBytes: number; availableBytes: number } | null = null;
      try {
        storageStats = await seedManager.getStorageStats();
      } catch {
        // Non-fatal
      }

      res.json({
        status: transmissionOk ? "ok" : "degraded",
        transmission: {
          connected: transmissionOk,
          ...(torrentStats && {
            activeTorrents: torrentStats.active,
            pausedTorrents: torrentStats.paused,
            totalTorrents: torrentStats.total,
            totalTorrentSizeBytes: torrentStats.totalSize,
          }),
        },
        storage: storageStats
          ? {
              lockerUsedBytes: storageStats.lockerBytes,
              diskTotalBytes: storageStats.totalBytes,
              diskAvailableBytes: storageStats.availableBytes,
            }
          : null,
      });
    } catch (err) {
      next(err);
    }
  },
);
