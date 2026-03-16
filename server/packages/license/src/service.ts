import { db, NotFoundError } from "@peerplay/shared";

export async function listUserLicenses(userId: string) {
  const licenses = await db.license.findMany({
    where: { userId },
    include: {
      game: {
        select: {
          id: true,
          slug: true,
          title: true,
          coverImageUrl: true,
          drmTier: true,
          developer: { select: { studioName: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return licenses.map((l) => ({
    id: l.id,
    status: l.status,
    createdAt: l.createdAt,
    game: {
      id: l.game.id,
      slug: l.game.slug,
      title: l.game.title,
      coverImageUrl: l.game.coverImageUrl,
      drmTier: l.game.drmTier,
      studioName: l.game.developer.studioName,
    },
  }));
}

export async function verifyLicense(userId: string, gameId: string) {
  const game = await db.game.findUnique({ where: { id: gameId } });
  if (!game) {
    throw new NotFoundError("Game");
  }

  const license = await db.license.findUnique({
    where: { userId_gameId: { userId, gameId } },
  });

  if (!license || license.status !== "ACTIVE") {
    return { valid: false, drmTier: game.drmTier };
  }

  return { valid: true, drmTier: game.drmTier };
}
