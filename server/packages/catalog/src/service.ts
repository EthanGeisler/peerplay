import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { db, NotFoundError, ForbiddenError, ValidationError, getConfig } from "@boilerdeck/shared";
import { createGameTorrent } from "@boilerdeck/torrent";
import type { DrmTier } from "@prisma/client";
import { Open as unzipOpen } from "unzipper";

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
    db.game.count({ where }),
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
    drmTier: g.drmTier,
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
      encryptionKey: {
        select: { id: true, algorithm: true, createdAt: true },
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
    drmTier: game.drmTier,
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
    encryptionKey: game.encryptionKey,
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

// ── Game directory scanning ─────────────────────────────────────────────────

export async function listGameDirectories() {
  const gamesDir = getConfig().GAMES_DIR;

  try {
    const entries = await fs.readdir(gamesDir, { withFileTypes: true });
    const dirs: { name: string; files: string[] }[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(gamesDir, entry.name);
      const files = await fs.readdir(dirPath);
      dirs.push({ name: entry.name, files });
    }

    return dirs;
  } catch {
    return [];
  }
}

export async function detectExecutable(dirname: string) {
  const gamesDir = getConfig().GAMES_DIR;

  // Prevent path traversal
  if (dirname.includes("..") || dirname.includes("/") || dirname.includes("\\")) {
    throw new ForbiddenError("Invalid directory name");
  }

  const dirPath = path.join(gamesDir, dirname);

  try {
    await fs.access(dirPath);
  } catch {
    throw new NotFoundError("Game directory");
  }

  // Recursively find all .exe files (uploads may nest files in subdirectories)
  const exeFiles: string[] = [];
  async function walk(dir: string, prefix: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel);
      } else if (entry.name.endsWith(".exe")) {
        exeFiles.push(rel);
      }
    }
  }
  await walk(dirPath, "");

  // Prefer non-console executables
  const mainExe = exeFiles.find((f) => !f.includes(".console.")) ?? exeFiles[0] ?? null;

  return { directory: dirname, executables: exeFiles, recommended: mainExe };
}

export async function autoDetectAndSetExe(
  gameId: string,
  developerId: string,
  dirname: string,
) {
  const game = await db.game.findUnique({ where: { id: gameId } });
  if (!game) throw new NotFoundError("Game");
  if (game.developerId !== developerId) {
    throw new ForbiddenError("You can only update your own games");
  }

  const result = await detectExecutable(dirname);
  if (!result.recommended) {
    throw new NotFoundError("No executable found in directory");
  }

  const updated = await db.game.update({
    where: { id: gameId },
    data: { exePath: result.recommended },
  });

  return { exePath: updated.exePath, detected: result };
}

// ── Upload & Processing ─────────────────────────────────────────────────────

async function getDirectorySize(dirPath: string): Promise<bigint> {
  let total = BigInt(0);
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(fullPath);
    } else {
      const stat = await fs.stat(fullPath);
      total += BigInt(stat.size);
    }
  }
  return total;
}

export async function uploadAndProcessVersion(
  gameId: string,
  developerId: string,
  versionId: string,
  zipPath: string,
) {
  // 1. Verify ownership and version status
  const game = await db.game.findUnique({ where: { id: gameId } });
  if (!game) throw new NotFoundError("Game");
  if (game.developerId !== developerId) {
    throw new ForbiddenError("You can only upload to your own games");
  }

  const version = await db.gameVersion.findUnique({ where: { id: versionId } });
  if (!version || version.gameId !== gameId) {
    throw new NotFoundError("Version");
  }
  if (version.status !== "PROCESSING") {
    throw new ForbiddenError("Version is not in PROCESSING state");
  }

  const gamesDir = getConfig().GAMES_DIR;
  const extractDir = path.join(gamesDir, game.slug);

  try {
    // 2. Extract zip
    await fs.mkdir(extractDir, { recursive: true });
    const directory = await unzipOpen.file(zipPath);
    await directory.extract({ path: extractDir });

    // 3. Calculate total file size
    const fileSizeBytes = await getDirectorySize(extractDir);

    // 4. Auto-detect exe
    let detectedExe: string | null = null;
    try {
      const result = await detectExecutable(game.slug);
      detectedExe = result.recommended;
    } catch {
      // Non-fatal — exe detection is best-effort
    }

    // 5. Create torrent
    const { torrentBuffer, infoHash, magnetUri } = await createGameTorrent(
      extractDir,
      game.slug,
    );

    // 6. Create Torrent DB record + update version in a transaction
    const updatedVersion = await db.$transaction(async (tx) => {
      const torrent = await tx.torrent.create({
        data: {
          infoHash,
          magnetUri,
          torrentFile: new Uint8Array(torrentBuffer),
        },
      });

      const ver = await tx.gameVersion.update({
        where: { id: versionId },
        data: {
          torrentId: torrent.id,
          fileSizeBytes,
          status: "READY",
        },
        include: {
          torrent: {
            select: { id: true, infoHash: true, magnetUri: true, createdAt: true },
          },
        },
      });

      // 8. Auto-set exePath if game doesn't have one
      if (!game.exePath && detectedExe) {
        await tx.game.update({
          where: { id: gameId },
          data: { exePath: detectedExe },
        });
      }

      return ver;
    });

    // 9. Add to Transmission (non-blocking, failure is non-fatal)
    addToTransmission(torrentBuffer).catch((err) => {
      console.warn("Failed to add torrent to Transmission:", err);
    });

    // 10. Clean up the temp zip
    await fs.unlink(zipPath).catch(() => {});

    return {
      id: updatedVersion.id,
      version: updatedVersion.version,
      status: updatedVersion.status,
      fileSizeBytes: Number(updatedVersion.fileSizeBytes),
      torrent: updatedVersion.torrent,
    };
  } catch (err) {
    // On any error, mark version as FAILED
    await db.gameVersion.update({
      where: { id: versionId },
      data: { status: "FAILED" },
    }).catch(() => {});

    // Clean up temp zip
    await fs.unlink(zipPath).catch(() => {});

    throw err;
  }
}

async function addToTransmission(torrentBuffer: Buffer): Promise<void> {
  const rpcUrl = getConfig().TRANSMISSION_RPC_URL;
  const gamesDir = getConfig().GAMES_DIR;
  const body = JSON.stringify({
    method: "torrent-add",
    arguments: {
      "metainfo": torrentBuffer.toString("base64"),
      "download-dir": gamesDir,
    },
  });

  console.log(`[transmission] Adding torrent to ${rpcUrl}, download-dir: ${gamesDir}`);

  // First attempt — will get 409 with session ID
  const first = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  let response: Response;

  if (first.status === 409) {
    const sessionId = first.headers.get("X-Transmission-Session-Id") ?? "";
    if (!sessionId) throw new Error("Transmission returned 409 but no session ID");

    // Retry with session ID
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Transmission-Session-Id": sessionId,
      },
      body,
    });
  } else {
    response = first;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Transmission RPC HTTP ${response.status}: ${text}`);
  }

  const result = await response.json() as { result: string; arguments?: Record<string, unknown> };
  if (result.result !== "success") {
    throw new Error(`Transmission RPC failed: ${result.result}`);
  }

  console.log("[transmission] Torrent added successfully:", JSON.stringify(result.arguments));
}
