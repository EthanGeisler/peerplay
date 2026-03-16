import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const game = await db.game.findUnique({
  where: { slug: "player-character-01-43dc" },
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

console.log("Game found:", !!game);
console.log("Status:", game?.status);
console.log("Versions:", game?.versions?.length);
if (game?.versions?.[0]) {
  console.log("Version:", game.versions[0].version);
  console.log("FileSizeBytes type:", typeof game.versions[0].fileSizeBytes);
  console.log("FileSizeBytes:", game.versions[0].fileSizeBytes);
}

await db.$disconnect();
