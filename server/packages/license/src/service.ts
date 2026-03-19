import { db } from "@boilerdeck/shared";

export async function listUserLicenses(userId: string) {
  const licenses = await db.license.findMany({
    where: { userId },
    include: {
      listing: {
        select: {
          id: true,
          slug: true,
          title: true,
          coverImageUrl: true,
          contentType: true,
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
      id: l.listing.id,
      slug: l.listing.slug,
      title: l.listing.title,
      coverImageUrl: l.listing.coverImageUrl,
      contentType: l.listing.contentType,
      studioName: l.listing.developer.studioName,
    },
  }));
}
