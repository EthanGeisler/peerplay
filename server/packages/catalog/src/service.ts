import crypto from "node:crypto";
import { db, NotFoundError, ForbiddenError, ValidationError } from "@boilerdeck/shared";

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
  exePath?: string;
  savePaths?: string[];
}

export interface UpdateGameInput {
  title?: string;
  description?: string;
  priceCents?: number;
  exePath?: string;
  savePaths?: string[];
  coverImageUrl?: string;
  screenshots?: string[];
}

export async function listPublishedGames(page: number, limit: number, search?: string) {
  const skip = (page - 1) * limit;

  const where = {
    status: "PUBLISHED" as const,
    ...(search && {
      title: { contains: search, mode: "insensitive" as const },
    }),
  };

  const [games, total] = await Promise.all([
    db.game.findMany({
      where,
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        priceCents: true,
        coverImageUrl: true,
        eventId: true,
        developer: {
          select: { studioName: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    db.game.count({ where }),
  ]);

  return {
    games: games.map((g) => ({
      id: g.id,
      slug: g.slug,
      title: g.title,
      description: g.description,
      priceCents: g.priceCents,
      coverImageUrl: g.coverImageUrl,
      eventId: g.eventId ?? null,
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
      developer: { select: { studioName: true, user: { select: { nostrPubkey: true } } } },
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
          torrent: { select: { infoHash: true } },
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
    coverImageUrl: game.coverImageUrl,
    screenshots: game.screenshots,
    exePath: game.exePath,
    eventId: game.eventId ?? null,
    studioName: game.developer.studioName,
    pubkey: game.developer.user?.nostrPubkey ?? null,
    latestVersion: game.versions[0]
      ? {
          id: game.versions[0].id,
          version: game.versions[0].version,
          fileSizeBytes: Number(game.versions[0].fileSizeBytes),
          changelog: game.versions[0].changelog,
          createdAt: game.versions[0].createdAt,
          infoHash: game.versions[0].torrent?.infoHash ?? null,
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
  const uploadUrl = `https://upload.boilerdeck.com/placeholder/${gameVersion.id}`;

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

export async function listDeveloperGames(developerId: string) {
  const games = await db.game.findMany({
    where: { developerId },
    include: {
      versions: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          version: true,
          status: true,
          fileSizeBytes: true,
          createdAt: true,
        },
      },
      _count: {
        select: { licenses: true, payments: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return games.map((g) => ({
    id: g.id,
    slug: g.slug,
    title: g.title,
    description: g.description,
    priceCents: g.priceCents,
    status: g.status,
    coverImageUrl: g.coverImageUrl,
    exePath: g.exePath,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    versionsCount: g.versions.length,
    latestVersion: g.versions[0] ?? null,
    licensesCount: g._count.licenses,
    salesCount: g._count.payments,
  }));
}

export async function getDeveloperGame(gameId: string, developerId: string) {
  const game = await db.game.findUnique({
    where: { id: gameId },
    include: {
      versions: {
        orderBy: { createdAt: "desc" },
        include: {
          torrent: {
            select: {
              id: true,
              infoHash: true,
              magnetUri: true,
              createdAt: true,
            },
          },
        },
      },
      _count: {
        select: { licenses: true, payments: true },
      },
    },
  });

  if (!game) {
    throw new NotFoundError("Game");
  }
  if (game.developerId !== developerId) {
    throw new ForbiddenError("You can only view your own games");
  }

  return {
    id: game.id,
    slug: game.slug,
    title: game.title,
    description: game.description,
    priceCents: game.priceCents,
    status: game.status,
    coverImageUrl: game.coverImageUrl,
    screenshots: game.screenshots,
    exePath: game.exePath,
    savePaths: game.savePaths,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    versions: game.versions.map((v) => ({
      id: v.id,
      version: v.version,
      status: v.status,
      fileSizeBytes: Number(v.fileSizeBytes),
      changelog: v.changelog,
      createdAt: v.createdAt,
      torrent: v.torrent,
    })),
    licensesCount: game._count.licenses,
    salesCount: game._count.payments,
  };
}

export async function publishGame(gameId: string, developerId: string) {
  const game = await db.game.findUnique({
    where: { id: gameId },
    include: {
      versions: {
        where: { status: "READY" },
        take: 1,
      },
      developer: true,
    },
  });

  if (!game) {
    throw new NotFoundError("Game");
  }
  if (game.developerId !== developerId) {
    throw new ForbiddenError("You can only publish your own games");
  }

  // Paid games require Stripe Connect onboarding
  if (game.priceCents > 0 && !game.developer.stripeOnboarded) {
    throw new ValidationError(
      "Complete Stripe onboarding before publishing paid games. Free games can be published without Stripe.",
    );
  }

  const updated = await db.game.update({
    where: { id: gameId },
    data: { status: "PUBLISHED" },
  });

  return updated;
}

export async function unpublishGame(gameId: string, developerId: string) {
  const game = await db.game.findUnique({ where: { id: gameId } });

  if (!game) {
    throw new NotFoundError("Game");
  }
  if (game.developerId !== developerId) {
    throw new ForbiddenError("You can only unpublish your own games");
  }

  const updated = await db.game.update({
    where: { id: gameId },
    data: { status: "DRAFT" },
  });

  return updated;
}

