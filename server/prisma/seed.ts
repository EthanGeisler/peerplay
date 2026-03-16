import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const db = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create admin user
  const adminHash = await bcrypt.hash("admin123456", 12);
  const admin = await db.user.upsert({
    where: { email: "admin@peerplay.io" },
    update: {},
    create: {
      email: "admin@peerplay.io",
      passwordHash: adminHash,
      displayName: "Admin",
      role: "ADMIN",
    },
  });

  // Create a test developer
  const devHash = await bcrypt.hash("developer123", 12);
  const devUser = await db.user.upsert({
    where: { email: "dev@example.com" },
    update: {},
    create: {
      email: "dev@example.com",
      passwordHash: devHash,
      displayName: "Test Developer",
      role: "DEVELOPER",
    },
  });

  const developer = await db.developer.upsert({
    where: { userId: devUser.id },
    update: {},
    create: {
      userId: devUser.id,
      studioName: "Indie Games Studio",
    },
  });

  // Create a test player
  const playerHash = await bcrypt.hash("player123456", 12);
  await db.user.upsert({
    where: { email: "player@example.com" },
    update: {},
    create: {
      email: "player@example.com",
      passwordHash: playerHash,
      displayName: "Test Player",
      role: "PLAYER",
    },
  });

  // Create sample games
  const game1 = await db.game.upsert({
    where: { slug: "space-explorer-abc1" },
    update: {},
    create: {
      developerId: developer.id,
      slug: "space-explorer-abc1",
      title: "Space Explorer",
      description: "A thrilling space exploration game where you navigate through uncharted galaxies.",
      priceCents: 1999,
      drmTier: "NONE",
      status: "PUBLISHED",
      exePath: "SpaceExplorer.exe",
      coverImageUrl: "https://placehold.co/460x215/1a1a2e/e94560?text=Space+Explorer",
      screenshots: [
        "https://placehold.co/1920x1080/1a1a2e/e94560?text=Screenshot+1",
        "https://placehold.co/1920x1080/1a1a2e/e94560?text=Screenshot+2",
      ],
    },
  });

  const game2 = await db.game.upsert({
    where: { slug: "dungeon-crawl-xyz2" },
    update: {},
    create: {
      developerId: developer.id,
      slug: "dungeon-crawl-xyz2",
      title: "Dungeon Crawl",
      description: "Descend into procedurally generated dungeons. Fight monsters, find loot, survive.",
      priceCents: 999,
      drmTier: "LIGHT",
      status: "PUBLISHED",
      exePath: "DungeonCrawl.exe",
      coverImageUrl: "https://placehold.co/460x215/16213e/0f3460?text=Dungeon+Crawl",
      screenshots: [],
    },
  });

  const game3 = await db.game.upsert({
    where: { slug: "pixel-racing-def3" },
    update: {},
    create: {
      developerId: developer.id,
      slug: "pixel-racing-def3",
      title: "Pixel Racing",
      description: "Retro-style racing with modern physics. Compete in online tournaments.",
      priceCents: 0,
      drmTier: "NONE",
      status: "PUBLISHED",
      exePath: "PixelRacing.exe",
      coverImageUrl: "https://placehold.co/460x215/0f3460/e94560?text=Pixel+Racing",
      screenshots: [],
    },
  });

  console.log("Seed complete!");
  console.log(`  Admin: admin@peerplay.io / admin123456`);
  console.log(`  Developer: dev@example.com / developer123`);
  console.log(`  Player: player@example.com / player123456`);
  console.log(`  Games: ${game1.title}, ${game2.title}, ${game3.title}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
