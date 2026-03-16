import crypto from "node:crypto";
import { db, NotFoundError, ForbiddenError } from "@peerplay/shared";
import type { DrmTier } from "@prisma/client";

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = crypto.randomBytes(2).toString("hex"); // 4 hex chars
  return `${base}-${suffix}`;
}

export interface CreateGameInput {
  title: string;
  description?: string;
  priceCents: number;
  drmTier?: DrmTier;
  exePath?: string;
  savePaths?: string[];
}

export interface UpdateGameInput {
  title?: string;
  description?: string;
  priceCents?: number;
  drmTier?: DrmTier;
  exePath?: string;
  savePaths?: string[];
  coverImageUrl?: string;
  screenshots?: string[];
}

export async function listPublishedGames(page: number, limit: number) {
  const skip = (page - 1) * limit;

  const [games, total] = await Promise.all([
    db.game.findMany({
      where: { status: "PUBLISHED" },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        priceCents: true,
        drmTier: true,
        coverImageUrl: true,
        developer: {
          select: { studioName: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    db.game.count({ where: { status: "PUBLISHED" } }),
  ]);

  return {
    games: games.map((g) => ({
      id: g.id,
      slug: g.slug,
      title: g.title,
      description: g.description,
      priceCents: g.priceCents,
      drmTier: g.drmTier,
      coverImageUrl: g.coverImageUrl,
      studioName: g.developer.studioName,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getGameBySlug(slug: string) {
  const game = await db.game.findUnique({
    where: { slug },
    include: {
      developer: { select: { studioName: true } },
      versions: {
        where: { status: "READY" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          version: true,
          fileSizeBytes: true,
          changelog: true,
          createdAt: true,
        },
      },
    },
  });

  if (!game || game.status !== "PUBLISHED") {
    throw new NotFoundError("Game");
  }

  return {
    id: game.id,
    slug: game.slug,
    title: game.title,
    description: game.description,
    priceCents: game.priceCents,
    drmTier: game.drmTier,
    coverImageUrl: game.coverImageUrl,
    screenshots: game.screenshots,
    exePath: game.exePath,
    studioName: game.developer.studioName,
    latestVersion: game.versions[0]
      ? {
          ...game.versions[0],
          fileSizeBytes: Number(game.versions[0].fileSizeBytes),
        }
      : null,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
  };
}

export async function createGame(developerId: string, input: CreateGameInput) {
  const slug = slugify(input.title);

  const game = await db.game.create({
    data: {
      developerId,
      slug,
      title: input.title,
      description: input.description ?? "",
      priceCents: input.priceCents,
      drmTier: input.drmTier ?? "NONE",
      exePath: input.exePath ?? null,
      savePaths: input.savePaths ?? [],
    },
  });

  return game;
}

export async function updateGame(
  gameId: string,
  developerId: string,
  input: UpdateGameInput,
) {
  const game = await db.game.findUnique({ where: { id: gameId } });
  if (!game) {
    throw new NotFoundError("Game");
  }
  if (game.developerId !== developerId) {
    throw new ForbiddenError("You can only update your own games");
  }

  const updated = await db.game.update({
    where: { id: gameId },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.priceCents !== undefined && { priceCents: input.priceCents }),
      ...(input.drmTier !== undefined && { drmTier: input.drmTier }),
      ...(input.exePath !== undefined && { exePath: input.exePath }),
      ...(input.savePaths !== undefined && { savePaths: input.savePaths }),
      ...(input.coverImageUrl !== undefined && { coverImageUrl: input.coverImageUrl }),
      ...(input.screenshots !== undefined && { screenshots: input.screenshots }),
    },
  });

  return updated;
}

export async function createVersion(
  gameId: string,
  developerId: string,
  version: string,
) {
  const game = await db.game.findUnique({ where: { id: gameId } });
  if (!game) {
    throw new NotFoundError("Game");
  }
  if (game.developerId !== developerId) {
    throw new ForbiddenError("You can only create versions for your own games");
  }

  const gameVersion = await db.gameVersion.create({
    data: {
      gameId,
      version,
      status: "PROCESSING",
    },
  });

  // TODO: Generate a real pre-signed upload URL (e.g., S3/B2)
  const uploadUrl = `https://upload.peerplay.dev/placeholder/${gameVersion.id}`;

  return {
    id: gameVersion.id,
    version: gameVersion.version,
    status: gameVersion.status,
    uploadUrl,
  };
}

export async function getDeveloperByUserId(userId: string) {
  const developer = await db.developer.findUnique({ where: { userId } });
  if (!developer) {
    throw new ForbiddenError("Developer profile not found. Register as a developer first.");
  }
  return developer;
}
