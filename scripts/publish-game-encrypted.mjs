#!/usr/bin/env node
/**
 * Publish an encrypted game to Peerplay.
 * Extends publish-game.mjs with EncryptionKey creation and drmTier setting.
 *
 * Usage: node scripts/publish-game-encrypted.mjs <gameId> <torrentPath> <magnetUri> <infoHash> <wrappedMasterKeyHex>
 *
 * The wrappedMasterKeyHex comes from encrypt-game.mjs output.
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const db = new PrismaClient();
const gameId = process.argv[2];
const torrentPath = process.argv[3];
const magnetUri = process.argv[4];
const infoHash = process.argv[5];
const wrappedMasterKeyHex = process.argv[6];

if (!gameId || !torrentPath || !magnetUri || !infoHash || !wrappedMasterKeyHex) {
  console.error(
    "Usage: node scripts/publish-game-encrypted.mjs <gameId> <torrentPath> <magnetUri> <infoHash> <wrappedMasterKeyHex>",
  );
  process.exit(1);
}

async function main() {
  // 1. Set game to ENCRYPTED and PUBLISHED
  const game = await db.game.update({
    where: { id: gameId },
    data: { status: "PUBLISHED", drmTier: "ENCRYPTED" },
  });
  console.log(`Published (ENCRYPTED): ${game.title} (${game.slug})`);

  // 2. Create or update EncryptionKey record
  const masterKeyEnc = Buffer.from(wrappedMasterKeyHex, "hex");
  const encKey = await db.encryptionKey.upsert({
    where: { gameId },
    update: { masterKeyEnc },
    create: {
      gameId,
      masterKeyEnc,
      algorithm: "aes-256-ctr",
    },
  });
  console.log(`EncryptionKey created: ${encKey.id}`);

  // 3. Create torrent record
  const torrentFile = fs.readFileSync(torrentPath);
  const torrent = await db.torrent.create({
    data: {
      infoHash,
      magnetUri,
      torrentFile,
      encryptionKeyId: encKey.id,
    },
  });
  console.log(`Torrent created: ${torrent.infoHash}`);

  // 4. Create game version linked to torrent
  const version = await db.gameVersion.create({
    data: {
      gameId: game.id,
      version: "0.1.0",
      torrentId: torrent.id,
      fileSizeBytes: 96_300_000,
      status: "READY",
      changelog: "Initial encrypted release",
    },
  });
  console.log(`Version ${version.version} created (status: ${version.status})`);

  console.log("\nEncrypted game is live on the platform!");
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
