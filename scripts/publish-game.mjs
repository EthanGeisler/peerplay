import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const db = new PrismaClient();
const gameId = process.argv[2];
const torrentPath = process.argv[3];
const magnetUri = process.argv[4];
const infoHash = process.argv[5];

async function main() {
  // 1. Publish the game
  const game = await db.game.update({
    where: { id: gameId },
    data: { status: "PUBLISHED" },
  });
  console.log(`Published: ${game.title} (${game.slug})`);

  // 2. Create torrent record
  const torrentFile = fs.readFileSync(torrentPath);
  const torrent = await db.torrent.create({
    data: {
      infoHash,
      magnetUri,
      torrentFile,
    },
  });
  console.log(`Torrent created: ${torrent.infoHash}`);

  // 3. Create game version linked to torrent
  const version = await db.gameVersion.create({
    data: {
      gameId: game.id,
      version: "0.1.0",
      torrentId: torrent.id,
      fileSizeBytes: 96_300_000,
      status: "READY",
      changelog: "Initial release — HomeWorld, ClassicWorld portals, procedural art",
    },
  });
  console.log(`Version ${version.version} created (status: ${version.status})`);

  console.log("\nGame is live on the platform!");
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
