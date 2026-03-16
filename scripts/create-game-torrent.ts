import createTorrent from "create-torrent";
import parseTorrent from "parse-torrent";
import fs from "node:fs";
import path from "node:path";

const gamePath = process.argv[2];
const outputPath = process.argv[3] ?? "game.torrent";

if (!gamePath) {
  console.error("Usage: tsx create-game-torrent.ts <game-directory> [output.torrent]");
  process.exit(1);
}

const absPath = path.resolve(gamePath);
console.log(`Creating torrent for: ${absPath}`);

createTorrent(absPath, {
  name: "PLAYER_CHARACTER_01",
  comment: "Player Character 01 — A 2D platformer with world-hopping portals. Published on BoilerDeck.",
  createdBy: "BoilerDeck v0.1.0",
  announceList: [],  // DHT-only for now (no private tracker yet)
  private: false,
  pieceLength: 2 ** 18, // 256KB pieces (good for ~100MB game)
}, (err: Error | null, torrentBuf: Buffer) => {
  if (err) {
    console.error("Error creating torrent:", err);
    process.exit(1);
  }

  fs.writeFileSync(outputPath, torrentBuf);

  const parsed = parseTorrent(torrentBuf);
  console.log("\nTorrent created successfully!");
  console.log(`  File: ${outputPath}`);
  console.log(`  Info hash: ${parsed.infoHash}`);
  console.log(`  Magnet URI: ${parseTorrent.toMagnetURI(parsed)}`);
  console.log(`  Pieces: ${(parsed as any).pieces?.length ?? "?"}`);
  console.log(`  Piece length: ${((parsed as any).pieceLength ?? 0) / 1024}KB`);
});
