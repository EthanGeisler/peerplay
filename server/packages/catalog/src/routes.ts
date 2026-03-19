import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { authenticate, requireRole, ValidationError, NotFoundError, getConfig, storeEvent, EVENT_KIND_GAME_LISTING, EVENT_KIND_GAME_VERSION, db, handleZodError } from "@boilerdeck/shared";
import { signEventForUser } from "@boilerdeck/auth";
import { federateListingOutbound } from "@boilerdeck/relay";
import * as catalogService from "./service.js";
import * as uploadService from "./upload.js";

export const catalogRouter = Router();

// Multer config — disk storage to .tmp/ inside GAMES_DIR, 2GB limit
const zipUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const tmpDir = path.join(getConfig().GAMES_DIR, ".tmp");
      fs.mkdirSync(tmpDir, { recursive: true });
      cb(null, tmpDir);
    },
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}-${file.originalname}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
  fileFilter: (_req, file, cb) => {
    // Accept zip files + common media types (validated post-upload based on contentType)
    const allowedMimes = new Set([
      "application/zip",
      "application/x-zip-compressed",
      "video/mp4",
      "video/webm",
      "video/x-matroska",
      "audio/mpeg",
      "audio/wav",
      "audio/ogg",
      "audio/flac",
      "application/octet-stream",
    ]);
    const allowedExts = new Set([".zip", ".mp4", ".webm", ".mkv", ".mp3", ".wav", ".ogg", ".flac"]);
    const ext = file.originalname.substring(file.originalname.lastIndexOf(".")).toLowerCase();
    if (allowedMimes.has(file.mimetype) || allowedExts.has(ext)) {
      cb(null, true);
    } else {
      cb(new ValidationError("Unsupported file type"));
    }
  },
});

// Multer config — cover image uploads to covers/ inside GAMES_DIR, 10MB limit
const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

const coverUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const coversDir = path.join(getConfig().GAMES_DIR, "covers");
      fs.mkdirSync(coversDir, { recursive: true });
      cb(null, coversDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ValidationError("Only image files (jpg, png, webp) are allowed"));
    }
  },
});

// ── Schemas ──────────────────────────────────────────────────────────────────

const contentTypeEnum = z.enum(["GAME", "VIDEO", "SOFTWARE", "AUDIO", "OTHER"]);

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  contentType: contentTypeEnum.optional(),
});

const createGameSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(5000).optional(),
  priceCents: z.number().int().min(0, "Price must be non-negative"),
  exePath: z.string().max(500).optional(),
  savePaths: z.array(z.string().max(500)).max(20).optional(),
  contentType: contentTypeEnum.optional(),
  metadata: z.record(z.any()).optional().transform((v) => v as import("@prisma/client").Prisma.InputJsonValue | undefined),
});

const updateGameSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  priceCents: z.number().int().min(0).optional(),
  exePath: z.string().max(500).optional(),
  savePaths: z.array(z.string().max(500)).max(20).optional(),
  coverImageUrl: z.string().max(500).optional(),
  screenshots: z.array(z.string().url()).max(10).optional(),
});

const createVersionSchema = z.object({
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "Version must be valid semver (e.g. 1.0.0)"),
});

// ── Public Routes ────────────────────────────────────────────────────────────

catalogRouter.get("/games", async (req, res, next) => {
  try {
    let params;
    try {
      params = paginationSchema.parse(req.query);
    } catch (err) {
      handleZodError(err);
    }
    const result = await catalogService.listPublishedListings(params.page, params.limit, params.search);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

catalogRouter.get("/games/:slug", async (req, res, next) => {
  try {
    const game = await catalogService.getListingBySlug(String(req.params.slug));
    res.json(game);
  } catch (err) {
    next(err);
  }
});

// ── Public Listings Routes (generalized) ────────────────────────────────────

catalogRouter.get("/listings", async (req, res, next) => {
  try {
    let params;
    try {
      params = paginationSchema.parse(req.query);
    } catch (err) {
      handleZodError(err);
    }
    const result = await catalogService.listPublishedListings(
      params.page,
      params.limit,
      params.search,
      params.contentType,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

catalogRouter.get("/listings/:slug", async (req, res, next) => {
  try {
    const listing = await catalogService.getListingBySlug(String(req.params.slug));
    res.json(listing);
  } catch (err) {
    next(err);
  }
});

// ── Developer Routes ─────────────────────────────────────────────────────────

catalogRouter.get(
  "/developer/games",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  async (req, res, next) => {
    try {
      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      const games = await catalogService.listDeveloperGames(developer.id);
      res.json({ games });
    } catch (err) {
      next(err);
    }
  },
);

catalogRouter.get(
  "/developer/games/:id",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  async (req, res, next) => {
    try {
      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      const game = await catalogService.getDeveloperGame(String(req.params.id), developer.id);
      res.json(game);
    } catch (err) {
      next(err);
    }
  },
);

catalogRouter.patch(
  "/developer/games/:id/publish",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  async (req, res, next) => {
    try {
      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      let game = await catalogService.publishGame(String(req.params.id), developer.id, req.user!.sub);

      // Sign and store a kind 30001 event with PUBLISHED status (non-fatal)
      try {
        const event = await signEventForUser(req.user!.sub, {
          kind: EVENT_KIND_GAME_LISTING,
          tags: [["d", game.slug], ["t", "game"], ["status", "PUBLISHED"]],
          content: JSON.stringify({
            title: game.title,
            description: game.description,
            priceCents: game.priceCents,
            slug: game.slug,
          }),
        });
        const result = await storeEvent(event);
        if (result !== "DUPLICATE") {
          game = await db.listing.update({
            where: { id: game.id },
            data: { eventId: event.id },
          });
        }
      } catch {
        // Signing failure is non-fatal
      }

      // Federate signed listing to external relays (non-fatal)
      try {
        if (game.creatorPublicKey && game.signature) {
          federateListingOutbound({
            id: game.id,
            title: game.title,
            slug: game.slug,
            description: game.description,
            priceCents: game.priceCents,
            contentType: game.contentType,
            creatorPublicKey: game.creatorPublicKey,
            signature: game.signature,
          });
        }
      } catch {
        // Federation failure is non-fatal
      }

      res.json(game);
    } catch (err) {
      next(err);
    }
  },
);

catalogRouter.patch(
  "/developer/games/:id/unpublish",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  async (req, res, next) => {
    try {
      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      let game = await catalogService.unpublishGame(String(req.params.id), developer.id);

      // Sign and store a kind 30001 event with DRAFT status (non-fatal)
      try {
        const event = await signEventForUser(req.user!.sub, {
          kind: EVENT_KIND_GAME_LISTING,
          tags: [["d", game.slug], ["t", "game"], ["status", "DRAFT"]],
          content: JSON.stringify({
            title: game.title,
            description: game.description,
            priceCents: game.priceCents,
            slug: game.slug,
          }),
        });
        const result = await storeEvent(event);
        if (result !== "DUPLICATE") {
          game = await db.listing.update({
            where: { id: game.id },
            data: { eventId: event.id },
          });
        }
      } catch {
        // Signing failure is non-fatal
      }

      res.json(game);
    } catch (err) {
      next(err);
    }
  },
);

// ── Developer Listings Routes (generalized) ─────────────────────────────────

catalogRouter.get(
  "/developer/listings",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  async (req, res, next) => {
    try {
      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      const listings = await catalogService.listDeveloperListings(developer.id);
      res.json({ games: listings });
    } catch (err) {
      next(err);
    }
  },
);

catalogRouter.get(
  "/developer/listings/:id",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  async (req, res, next) => {
    try {
      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      const listing = await catalogService.getDeveloperListing(String(req.params.id), developer.id);
      res.json(listing);
    } catch (err) {
      next(err);
    }
  },
);

catalogRouter.post(
  "/developer/listings",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  async (req, res, next) => {
    try {
      let input;
      try {
        input = createGameSchema.parse(req.body);
      } catch (err) {
        handleZodError(err);
      }
      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      // Look up user's nostrPubkey to set as creatorPublicKey
      const user = await db.user.findUnique({ where: { id: req.user!.sub }, select: { nostrPubkey: true } });
      let listing = await catalogService.createListing(developer.id, input, user?.nostrPubkey);

      // Sign and store a kind 30001 event (non-blocking on failure)
      try {
        const contentTag = input.contentType?.toLowerCase() ?? "game";
        const event = await signEventForUser(req.user!.sub, {
          kind: EVENT_KIND_GAME_LISTING,
          tags: [["d", listing.slug], ["t", contentTag]],
          content: JSON.stringify({
            title: listing.title,
            description: listing.description,
            priceCents: listing.priceCents,
            slug: listing.slug,
            contentType: listing.contentType,
          }),
        });
        const result = await storeEvent(event);
        if (result !== "DUPLICATE") {
          listing = await db.listing.update({
            where: { id: listing.id },
            data: { eventId: event.id },
          });
        }
      } catch {
        // Signing failure is non-fatal
      }

      res.status(201).json(listing);
    } catch (err) {
      next(err);
    }
  },
);

catalogRouter.put(
  "/developer/listings/:id",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  async (req, res, next) => {
    try {
      let input;
      try {
        input = updateGameSchema.parse(req.body);
      } catch (err) {
        handleZodError(err);
      }
      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      let listing = await catalogService.updateListing(String(req.params.id), developer.id, input);

      // Sign and store event (non-fatal)
      try {
        const event = await signEventForUser(req.user!.sub, {
          kind: EVENT_KIND_GAME_LISTING,
          tags: [["d", listing.slug], ["t", listing.contentType.toLowerCase()], ["status", listing.status]],
          content: JSON.stringify({
            title: listing.title,
            description: listing.description,
            priceCents: listing.priceCents,
            slug: listing.slug,
            contentType: listing.contentType,
          }),
        });
        const result = await storeEvent(event);
        if (result !== "DUPLICATE") {
          listing = await db.listing.update({
            where: { id: listing.id },
            data: { eventId: event.id },
          });
        }
      } catch {
        // Signing failure is non-fatal
      }

      res.json(listing);
    } catch (err) {
      next(err);
    }
  },
);

catalogRouter.patch(
  "/developer/listings/:id/publish",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  async (req, res, next) => {
    try {
      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      let listing = await catalogService.publishListing(String(req.params.id), developer.id, req.user!.sub);

      try {
        const event = await signEventForUser(req.user!.sub, {
          kind: EVENT_KIND_GAME_LISTING,
          tags: [["d", listing.slug], ["t", listing.contentType.toLowerCase()], ["status", "PUBLISHED"]],
          content: JSON.stringify({
            title: listing.title,
            description: listing.description,
            priceCents: listing.priceCents,
            slug: listing.slug,
            contentType: listing.contentType,
          }),
        });
        const result = await storeEvent(event);
        if (result !== "DUPLICATE") {
          listing = await db.listing.update({
            where: { id: listing.id },
            data: { eventId: event.id },
          });
        }
      } catch {
        // Signing failure is non-fatal
      }

      // Federate signed listing to external relays (non-fatal)
      try {
        if (listing.creatorPublicKey && listing.signature) {
          federateListingOutbound({
            id: listing.id,
            title: listing.title,
            slug: listing.slug,
            description: listing.description,
            priceCents: listing.priceCents,
            contentType: listing.contentType,
            creatorPublicKey: listing.creatorPublicKey,
            signature: listing.signature,
          });
        }
      } catch {
        // Federation failure is non-fatal
      }

      res.json(listing);
    } catch (err) {
      next(err);
    }
  },
);

catalogRouter.patch(
  "/developer/listings/:id/unpublish",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  async (req, res, next) => {
    try {
      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      let listing = await catalogService.unpublishListing(String(req.params.id), developer.id);

      try {
        const event = await signEventForUser(req.user!.sub, {
          kind: EVENT_KIND_GAME_LISTING,
          tags: [["d", listing.slug], ["t", listing.contentType.toLowerCase()], ["status", "DRAFT"]],
          content: JSON.stringify({
            title: listing.title,
            description: listing.description,
            priceCents: listing.priceCents,
            slug: listing.slug,
            contentType: listing.contentType,
          }),
        });
        const result = await storeEvent(event);
        if (result !== "DUPLICATE") {
          listing = await db.listing.update({
            where: { id: listing.id },
            data: { eventId: event.id },
          });
        }
      } catch {
        // Signing failure is non-fatal
      }

      res.json(listing);
    } catch (err) {
      next(err);
    }
  },
);

catalogRouter.post(
  "/developer/listings/:id/versions",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  async (req, res, next) => {
    try {
      let input;
      try {
        input = createVersionSchema.parse(req.body);
      } catch (err) {
        handleZodError(err);
      }
      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      const result = await catalogService.createVersion(
        String(req.params.id),
        developer.id,
        input.version,
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

catalogRouter.post(
  "/developer/listings/:id/cover",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  coverUpload.single("cover"),
  async (req, res, next) => {
    const tmpPath = req.file?.path;
    try {
      if (!req.file) {
        throw new ValidationError("No image file provided");
      }

      const listingId = String(req.params.id);
      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      const listing = await catalogService.updateListing(listingId, developer.id, {
        coverImageUrl: `/api/covers/${listingId}`,
      });

      const coversDir = path.join(getConfig().GAMES_DIR, "covers");
      const uploadedExt = path.extname(req.file.filename).toLowerCase();
      const finalPath = path.join(coversDir, `${listingId}${uploadedExt}`);

      await fsp.rename(tmpPath!, finalPath);

      for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
        if (ext !== uploadedExt) {
          await fsp.unlink(path.join(coversDir, `${listingId}${ext}`)).catch(() => {});
        }
      }

      res.json(listing);
    } catch (err) {
      if (tmpPath) {
        await fsp.unlink(tmpPath).catch(() => {});
      }
      next(err);
    }
  },
);

catalogRouter.post(
  "/developer/listings/:id/versions/:versionId/upload",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  (req, _res, next) => {
    req.setTimeout(30 * 60 * 1000);
    next();
  },
  zipUpload.single("gameZip"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new ValidationError("No zip file provided");
      }

      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      const result = await uploadService.uploadAndProcessVersion(
        String(req.params.id),
        developer.id,
        String(req.params.versionId),
        req.file.path,
      );

      try {
        const listing = await db.listing.findUnique({ where: { id: String(req.params.id) } });
        if (listing) {
          const event = await signEventForUser(req.user!.sub, {
            kind: EVENT_KIND_GAME_VERSION,
            tags: [
              ["d", `${listing.slug}:${result.version}`],
              ...(listing.eventId ? [["e", listing.eventId]] : []),
              ["game", listing.slug],
            ],
            content: JSON.stringify({
              version: result.version,
              fileSizeBytes: result.fileSizeBytes,
              infoHash: result.torrent?.infoHash ?? null,
            }),
          });
          await storeEvent(event);
        }
      } catch {
        // Signing failure is non-fatal
      }

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

catalogRouter.post(
  "/developer/listings/:id/detect-exe",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  async (req, res, next) => {
    try {
      const { dirname } = req.body;
      if (!dirname || typeof dirname !== "string") {
        throw new ValidationError("dirname is required");
      }
      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      const result = await uploadService.autoDetectAndSetExe(
        String(req.params.id),
        developer.id,
        dirname,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ── Game directory scanning ──────────────────────────────────────────────────

catalogRouter.get(
  "/developer/game-dirs",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  async (_req, res, next) => {
    try {
      const dirs = await uploadService.listGameDirectories();
      res.json({ directories: dirs });
    } catch (err) {
      next(err);
    }
  },
);

catalogRouter.get(
  "/developer/game-dirs/:dirname/executables",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  async (req, res, next) => {
    try {
      const result = await uploadService.detectExecutable(String(req.params.dirname));
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

catalogRouter.post(
  "/developer/games/:id/detect-exe",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  async (req, res, next) => {
    try {
      const { dirname } = req.body;
      if (!dirname || typeof dirname !== "string") {
        throw new ValidationError("dirname is required");
      }
      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      const result = await uploadService.autoDetectAndSetExe(
        String(req.params.id),
        developer.id,
        dirname,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ── Game CRUD ───────────────────────────────────────────────────────────────

catalogRouter.post(
  "/developer/games",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  async (req, res, next) => {
    try {
      let input;
      try {
        input = createGameSchema.parse(req.body);
      } catch (err) {
        handleZodError(err);
      }
      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      // Look up user's nostrPubkey to set as creatorPublicKey
      const gameUser = await db.user.findUnique({ where: { id: req.user!.sub }, select: { nostrPubkey: true } });
      let game = await catalogService.createGame(developer.id, input, gameUser?.nostrPubkey);

      // Sign and store a kind 30001 event for this game (non-blocking on failure)
      try {
        const event = await signEventForUser(req.user!.sub, {
          kind: EVENT_KIND_GAME_LISTING,
          tags: [["d", game.slug], ["t", "game"]],
          content: JSON.stringify({
            title: game.title,
            description: game.description,
            priceCents: game.priceCents,
            slug: game.slug,
          }),
        });
        const result = await storeEvent(event);
        if (result !== "DUPLICATE") {
          game = await db.listing.update({
            where: { id: game.id },
            data: { eventId: event.id },
          });
        }
      } catch {
        // Signing failure is non-fatal — game exists with eventId: null
      }

      res.status(201).json(game);
    } catch (err) {
      next(err);
    }
  },
);

catalogRouter.put(
  "/developer/games/:id",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  async (req, res, next) => {
    try {
      let input;
      try {
        input = updateGameSchema.parse(req.body);
      } catch (err) {
        handleZodError(err);
      }
      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      let game = await catalogService.updateGame(String(req.params.id), developer.id, input);

      // Sign and store a kind 30001 event for the updated game (non-fatal)
      try {
        const event = await signEventForUser(req.user!.sub, {
          kind: EVENT_KIND_GAME_LISTING,
          tags: [["d", game.slug], ["t", "game"], ["status", game.status]],
          content: JSON.stringify({
            title: game.title,
            description: game.description,
            priceCents: game.priceCents,
            slug: game.slug,
          }),
        });
        const result = await storeEvent(event);
        if (result !== "DUPLICATE") {
          game = await db.listing.update({
            where: { id: game.id },
            data: { eventId: event.id },
          });
        }
      } catch {
        // Signing failure is non-fatal
      }

      res.json(game);
    } catch (err) {
      next(err);
    }
  },
);

catalogRouter.post(
  "/developer/games/:id/versions",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  async (req, res, next) => {
    try {
      let input;
      try {
        input = createVersionSchema.parse(req.body);
      } catch (err) {
        handleZodError(err);
      }
      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      const result = await catalogService.createVersion(
        String(req.params.id),
        developer.id,
        input.version,
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ── Cover Image Upload ──────────────────────────────────────────────────────

catalogRouter.post(
  "/developer/games/:id/cover",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  coverUpload.single("cover"),
  async (req, res, next) => {
    const tmpPath = req.file?.path;
    try {
      if (!req.file) {
        throw new ValidationError("No image file provided");
      }

      const gameId = String(req.params.id);
      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);

      // Ownership check — updateGame verifies developer owns the game
      const game = await catalogService.updateGame(gameId, developer.id, {
        coverImageUrl: `/api/covers/${gameId}`,
      });

      // Ownership passed — rename temp file to final name and clean up old covers
      const coversDir = path.join(getConfig().GAMES_DIR, "covers");
      const uploadedExt = path.extname(req.file.filename).toLowerCase();
      const finalPath = path.join(coversDir, `${gameId}${uploadedExt}`);

      await fsp.rename(tmpPath!, finalPath);

      // Delete old cover files with different extensions
      for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
        if (ext !== uploadedExt) {
          await fsp.unlink(path.join(coversDir, `${gameId}${ext}`)).catch(() => {});
        }
      }

      res.json(game);
    } catch (err) {
      // Clean up temp file if ownership check or anything else failed
      if (tmpPath) {
        await fsp.unlink(tmpPath).catch(() => {});
      }
      next(err);
    }
  },
);

// ── Public Cover Serve ──────────────────────────────────────────────────────

catalogRouter.get("/covers/:gameId", async (req, res, next) => {
  try {
    const gameId = String(req.params.gameId);

    // Strict gameId validation — only alphanumeric, hyphens, underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(gameId)) {
      throw new ValidationError("Invalid game ID");
    }

    const coversDir = path.join(getConfig().GAMES_DIR, "covers");
    const extensions = [".jpg", ".jpeg", ".png", ".webp"];
    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
    };

    for (const ext of extensions) {
      const filePath = path.join(coversDir, `${gameId}${ext}`);
      try {
        await fsp.access(filePath);
      } catch {
        continue;
      }
      res.set("Content-Type", mimeMap[ext]!);
      res.set("Cache-Control", "public, max-age=86400");
      res.sendFile(filePath);
      return;
    }

    throw new NotFoundError("Cover image");
  } catch (err) {
    next(err);
  }
});

// ── File Upload ─────────────────────────────────────────────────────────────

catalogRouter.post(
  "/developer/games/:id/versions/:versionId/upload",
  authenticate,
  requireRole("DEVELOPER", "ADMIN"),
  (req, _res, next) => {
    // Set a 30-minute timeout for large uploads
    req.setTimeout(30 * 60 * 1000);
    next();
  },
  zipUpload.single("gameZip"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new ValidationError("No zip file provided");
      }

      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      const result = await uploadService.uploadAndProcessVersion(
        String(req.params.id),
        developer.id,
        String(req.params.versionId),
        req.file.path,
      );

      // Sign and store a kind 30002 event for the game version (non-fatal)
      try {
        const game = await db.listing.findUnique({ where: { id: String(req.params.id) } });
        if (game) {
          const event = await signEventForUser(req.user!.sub, {
            kind: EVENT_KIND_GAME_VERSION,
            tags: [
              ["d", `${game.slug}:${result.version}`],
              ...(game.eventId ? [["e", game.eventId]] : []),
              ["game", game.slug],
            ],
            content: JSON.stringify({
              version: result.version,
              fileSizeBytes: result.fileSizeBytes,
              infoHash: result.torrent?.infoHash ?? null,
            }),
          });
          await storeEvent(event);
        }
      } catch {
        // Signing failure is non-fatal
      }

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
