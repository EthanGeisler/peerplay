/**
 * Locker REST routes — upload, list, delete, and torrent retrieval.
 *
 * All routes are authenticated (JWT middleware).
 *
 * Routes:
 * - POST /upload — multipart file upload to locker
 * - GET /entries — list user's locker entries (decrypted)
 * - DELETE /entries/:entryId — delete a locker entry (NIP-09)
 * - GET /entries/:entryId/torrent — download .torrent file
 */

import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { authenticate, ValidationError } from "@boilerdeck/shared";
import { getLockerConfig } from "./config.js";
import * as lockerService from "./service.js";

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
