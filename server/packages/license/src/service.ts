import { db } from "@boilerdeck/shared";

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
      studioName: l.game.developer.studioName,
    },
  }));
}
