import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

try {
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

  const result = {
    id: game.id,
    slug: game.slug,
    title: game.title,
    description: game.description,
    priceCents: game.priceCents,
    coverImageUrl: game.coverImageUrl,
    screenshots: game.screenshots,
    exePath: game.exePath,
    studioName: game.developer.studioName,
    latestVersion: game.versions[0]
      ? { ...game.versions[0], fileSizeBytes: Number(game.versions[0].fileSizeBytes) }
      : null,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
  };

  const json = JSON.stringify(result);
  console.log("SUCCESS:", json.substring(0, 200));
} catch (e) {
  console.error("FAILED:", e.message);
  console.error(e.stack);
}

await db.$disconnect();
