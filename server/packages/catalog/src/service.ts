import crypto from "node:crypto";
import { db, NotFoundError, ForbiddenError, ValidationError, redis } from "@boilerdeck/shared";
import type { ContentType, Prisma } from "@prisma/client";

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

export interface CreateListingInput {
  title: string;
  description?: string;
  priceCents: number;
  exePath?: string;
  savePaths?: string[];
  contentType?: ContentType;
  metadata?: Prisma.InputJsonValue;
}

export interface UpdateListingInput {
  title?: string;
  description?: string;
  priceCents?: number;
  exePath?: string;
  savePaths?: string[];
  coverImageUrl?: string;
  screenshots?: string[];
  contentType?: ContentType;
  metadata?: Prisma.InputJsonValue;
}

// Aliases for backwards compatibility
export type CreateGameInput = CreateListingInput;
export type UpdateGameInput = UpdateListingInput;

export async function listPublishedListings(
  page: number,
  limit: number,
  search?: string,
  contentType?: ContentType,
) {
  const skip = (page - 1) * limit;

  const where = {
    status: "PUBLISHED" as const,
    ...(search && {
      title: { contains: search, mode: "insensitive" as const },
    }),
    ...(contentType && { contentType }),
  };

  const [listings, total] = await Promise.all([
    db.listing.findMany({
      where,
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        priceCents: true,
        coverImageUrl: true,
        contentType: true,
        metadata: true,
        eventId: true,
        developer: {
          select: { studioName: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    db.listing.count({ where }),
  ]);

  return {
    games: listings.map((g) => ({
      id: g.id,
      slug: g.slug,
      title: g.title,
      description: g.description,
      priceCents: g.priceCents,
      coverImageUrl: g.coverImageUrl,
      contentType: g.contentType,
      metadata: g.metadata,
      eventId: g.eventId ?? null,
      studioName: g.developer.studioName,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getListingBySlug(slug: string) {
  const game = await db.listing.findUnique({
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
    throw new NotFoundError("Listing");
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
    contentType: game.contentType,
    metadata: game.metadata,
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

export async function createListing(developerId: string, input: CreateListingInput, creatorPublicKey?: string | null) {
  const slug = slugify(input.title);

  const game = await db.listing.create({
    data: {
      developerId,
      slug,
      title: input.title,
      description: input.description ?? "",
      priceCents: input.priceCents,
      exePath: input.exePath ?? null,
      savePaths: input.savePaths ?? [],
      contentType: input.contentType ?? "GAME",
      metadata: input.metadata ?? {},
      ...(creatorPublicKey ? { creatorPublicKey } : {}),
    },
  });

  return game;
}

export async function updateListing(
  gameId: string,
  developerId: string,
  input: UpdateListingInput,
) {
  const game = await db.listing.findUnique({ where: { id: gameId } });
  if (!game) {
    throw new NotFoundError("Listing");
  }
  if (game.developerId !== developerId) {
    throw new ForbiddenError("You can only update your own listings");
  }

  const updated = await db.listing.update({
    where: { id: gameId },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.priceCents !== undefined && { priceCents: input.priceCents }),
      ...(input.exePath !== undefined && { exePath: input.exePath }),
      ...(input.savePaths !== undefined && { savePaths: input.savePaths }),
      ...(input.coverImageUrl !== undefined && { coverImageUrl: input.coverImageUrl }),
      ...(input.screenshots !== undefined && { screenshots: input.screenshots }),
      ...(input.contentType !== undefined && { contentType: input.contentType }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
    },
  });

  return updated;
}

export async function createVersion(
  gameId: string,
  developerId: string,
  version: string,
) {
  const game = await db.listing.findUnique({ where: { id: gameId } });
  if (!game) {
    throw new NotFoundError("Listing");
  }
  if (game.developerId !== developerId) {
    throw new ForbiddenError("You can only create versions for your own listings");
  }

  const gameVersion = await db.listingVersion.create({
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

export async function listDeveloperListings(developerId: string) {
  const games = await db.listing.findMany({
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
    contentType: g.contentType,
    exePath: g.exePath,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    versionsCount: g.versions.length,
    latestVersion: g.versions[0] ?? null,
    licensesCount: g._count.licenses,
    salesCount: g._count.payments,
  }));
}

export async function getDeveloperListing(gameId: string, developerId: string) {
  const game = await db.listing.findUnique({
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
    throw new NotFoundError("Listing");
  }
  if (game.developerId !== developerId) {
    throw new ForbiddenError("You can only view your own listings");
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
    contentType: game.contentType,
    metadata: game.metadata,
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

export async function publishListing(gameId: string, developerId: string, userId?: string) {
  const game = await db.listing.findUnique({
    where: { id: gameId },
    include: {
      versions: {
        where: { status: "READY" },
        take: 1,
      },
      developer: {
        include: { user: { select: { nostrPubkey: true, custodyMode: true } } },
      },
    },
  });

  if (!game) {
    throw new NotFoundError("Listing");
  }
  if (game.developerId !== developerId) {
    throw new ForbiddenError("You can only publish your own listings");
  }

  // Paid listings require Stripe Connect onboarding
  if (game.priceCents > 0 && !game.developer.stripeOnboarded) {
    throw new ValidationError(
      "Complete Stripe onboarding before publishing paid listings. Free listings can be published without Stripe.",
    );
  }

  // Build update data — always set status to PUBLISHED
  const updateData: Record<string, unknown> = { status: "PUBLISHED" };

  // Set creatorPublicKey if not already set
  const pubkey = game.developer.user?.nostrPubkey ?? null;
  if (pubkey && !game.creatorPublicKey) {
    updateData.creatorPublicKey = pubkey;
  }

  // Try to generate a Schnorr signature for the listing
  if (userId && pubkey && game.developer.user?.custodyMode !== "SELF_CUSTODY") {
    try {
      const sig = await signListingData(userId, {
        title: game.title,
        slug: game.slug,
        description: game.description,
        priceCents: game.priceCents,
        contentType: game.contentType,
      });
      if (sig) {
        updateData.signature = sig;
      }
    } catch {
      // Signing failure is non-fatal — listing is still published without signature
    }
  }

  const updated = await db.listing.update({
    where: { id: gameId },
    data: updateData,
  });

  return updated;
}

/**
 * Sign listing data using the user's cached signing key from Redis.
 * Returns the hex signature string, or null if signing is not possible.
 */
async function signListingData(
  userId: string,
  data: { title: string; slug: string; description: string; priceCents: number; contentType: string },
): Promise<string | null> {
  const { schnorr } = await import("@noble/curves/secp256k1.js");
  const { sha256 } = await import("@noble/hashes/sha2.js");
  const { hexToBytes, bytesToHex } = await import("@noble/hashes/utils.js");

  // Load cached signing key from Redis
  const cached = await redis.get(`signing_key:${userId}`);
  if (!cached) return null;

  // Decrypt the cached key (format: nonce:tag:ciphertext, encrypted with SIGNING_CACHE_KEY)
  const signingCacheKey = process.env.SIGNING_CACHE_KEY;
  if (!signingCacheKey) return null;

  const parts = cached.split(":");
  if (parts.length !== 3) return null;

  const nonce = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const ciphertext = Buffer.from(parts[2], "hex");
  const key = Buffer.from(signingCacheKey, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);

  const privateKey = new Uint8Array(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]),
  );

  // Sign: canonical JSON → SHA-256 → Schnorr
  const canonical = JSON.stringify({
    title: data.title,
    slug: data.slug,
    description: data.description,
    priceCents: data.priceCents,
    contentType: data.contentType,
  });
  const messageBytes = new TextEncoder().encode(canonical);
  const messageHash = sha256(messageBytes);
  const signature = schnorr.sign(messageHash, privateKey);

  return bytesToHex(signature);
}

export async function unpublishListing(gameId: string, developerId: string) {
  const game = await db.listing.findUnique({ where: { id: gameId } });

  if (!game) {
    throw new NotFoundError("Listing");
  }
  if (game.developerId !== developerId) {
    throw new ForbiddenError("You can only unpublish your own listings");
  }

  const updated = await db.listing.update({
    where: { id: gameId },
    data: { status: "DRAFT" },
  });

  return updated;
}

// ── Backwards-compatible aliases ──────────────────────────────────────────────
export const listPublishedGames = listPublishedListings;
export const getGameBySlug = getListingBySlug;
export const createGame = createListing;
export const updateGame = updateListing;
export const listDeveloperGames = listDeveloperListings;
export const getDeveloperGame = getDeveloperListing;
export const publishGame = publishListing;
export const unpublishGame = unpublishListing;
