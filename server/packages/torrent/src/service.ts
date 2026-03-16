import { db, NotFoundError, ForbiddenError } from "@peerplay/shared";

export async function getLatestTorrent(userId: string, gameId: string) {
  // Verify the user owns a valid license
  const license = await db.license.findUnique({
    where: { userId_gameId: { userId, gameId } },
  });
  if (!license || license.status !== "ACTIVE") {
    throw new ForbiddenError("You do not own a valid license for this game");
  }

  // Find the latest READY version with its torrent
  const version = await db.gameVersion.findFirst({
    where: {
      gameId,
      status: "READY",
      torrentId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    include: {
      torrent: true,
      game: {
        select: { drmTier: true, encryptionKey: { select: { algorithm: true } } },
      },
    },
  });

  if (!version || !version.torrent) {
    throw new NotFoundError("Torrent");
  }

  const encrypted = version.game.drmTier === "ENCRYPTED";

  return {
    gameId,
    versionId: version.id,
    version: version.version,
    fileSizeBytes: version.fileSizeBytes.toString(),
    magnetUri: version.torrent.magnetUri,
    infoHash: version.torrent.infoHash,
    encrypted,
    ...(encrypted && version.game.encryptionKey
      ? { algorithm: version.game.encryptionKey.algorithm }
      : {}),
  };
}
