/// <reference path="./vendor.d.ts" />
import { db, NotFoundError, ForbiddenError } from "@boilerdeck/shared";
import createTorrent from "create-torrent";
import parseTorrent, { toMagnetURI } from "parse-torrent";

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

const ANNOUNCE_LIST = [
  ["udp://tracker.opentrackr.org:1337/announce"],
  ["udp://open.tracker.cl:1337/announce"],
  ["udp://open.demonii.com:1339/announce"],
  ["udp://open.stealth.si:80/announce"],
  ["udp://tracker.torrent.eu.org:451/announce"],
  ["udp://exodus.desync.com:6969/announce"],
  ["wss://tracker.openwebtorrent.com"],
  ["wss://tracker.webtorrent.dev"],
  ["wss://tracker.btorrent.xyz"],
];

export async function createGameTorrent(
  dirPath: string,
  name: string,
): Promise<{ torrentBuffer: Buffer; infoHash: string; magnetUri: string }> {
  const torrentBuffer = await new Promise<Buffer>((resolve, reject) => {
    createTorrent(
      dirPath,
      {
        name,
        comment: `Published on BoilerDeck`,
        createdBy: "BoilerDeck",
        announceList: ANNOUNCE_LIST,
        private: false,
        pieceLength: 2 ** 18,
      },
      (err: Error | null, buf: Buffer) => {
        if (err) reject(err);
        else resolve(buf);
      },
    );
  });

  const parsed = await parseTorrent(torrentBuffer);
  const magnetUri = toMagnetURI(parsed);

  return {
    torrentBuffer,
    infoHash: parsed.infoHash!,
    magnetUri,
  };
}
