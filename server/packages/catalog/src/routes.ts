import { Router } from "express";
import { z, ZodError } from "zod";
import { authenticate, requireRole, ValidationError } from "@peerplay/shared";
import * as catalogService from "./service.js";

export const catalogRouter = Router();

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
