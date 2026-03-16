import path from "node:path";
import fs from "node:fs";
import { Router } from "express";
import { z, ZodError } from "zod";
import multer from "multer";
import { authenticate, requireRole, ValidationError, getConfig } from "@boilerdeck/shared";
import * as catalogService from "./service.js";

export const catalogRouter = Router();

// Multer config — disk storage to .tmp/ inside GAMES_DIR, 2GB limit
const upload = multer({
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
    if (file.mimetype === "application/zip" || file.originalname.endsWith(".zip")) {
      cb(null, true);
    } else {
      cb(new ValidationError("Only .zip files are allowed"));
    }
  },
});

function handleZodError(err: unknown): never {
  if (err instanceof ZodError) {
    throw new ValidationError(err.errors.map((e) => e.message).join(", "));
  }
  throw err;
}

// ── Schemas ──────────────────────────────────────────────────────────────────

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const createGameSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(5000).optional(),
  priceCents: z.number().int().min(0, "Price must be non-negative"),
  drmTier: z.enum(["NONE", "LIGHT", "ENCRYPTED"]).optional(),
  exePath: z.string().max(500).optional(),
  savePaths: z.array(z.string().max(500)).max(20).optional(),
});

const updateGameSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  priceCents: z.number().int().min(0).optional(),
  drmTier: z.enum(["NONE", "LIGHT", "ENCRYPTED"]).optional(),
  exePath: z.string().max(500).optional(),
  savePaths: z.array(z.string().max(500)).max(20).optional(),
  coverImageUrl: z.string().url().optional(),
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
    const result = await catalogService.listPublishedGames(params.page, params.limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

catalogRouter.get("/games/:slug", async (req, res, next) => {
  try {
    const game = await catalogService.getGameBySlug(String(req.params.slug));
    res.json(game);
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
      const game = await catalogService.publishGame(String(req.params.id), developer.id);
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
      const game = await catalogService.unpublishGame(String(req.params.id), developer.id);
      res.json(game);
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
      const dirs = await catalogService.listGameDirectories();
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
      const result = await catalogService.detectExecutable(String(req.params.dirname));
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
      const result = await catalogService.autoDetectAndSetExe(
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
      const game = await catalogService.createGame(developer.id, input);
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
      const game = await catalogService.updateGame(String(req.params.id), developer.id, input);
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
  upload.single("gameZip"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new ValidationError("No zip file provided");
      }

      const developer = await catalogService.getDeveloperByUserId(req.user!.sub);
      const result = await catalogService.uploadAndProcessVersion(
        String(req.params.id),
        developer.id,
        String(req.params.versionId),
        req.file.path,
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
