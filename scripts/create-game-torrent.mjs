import createTorrent from "create-torrent";
import parseTorrent from "parse-torrent";
import fs from "node:fs";
import path from "node:path";

const gamePath = process.argv[2];
const outputPath = process.argv[3] ?? "game.torrent";

if (!gamePath) {
  console.error("Usage: node create-game-torrent.mjs <game-directory> [output.torrent]");
  process.exit(1);
}

const absPath = path.resolve(gamePath);
console.log(`Creating torrent for: ${absPath}`);

createTorrent(absPath, {
  name: "PLAYER_CHARACTER_01",
  comment: "Player Character 01 — A 2D platformer with world-hopping portals. Published on Peerplay.",
  createdBy: "Peerplay v0.1.0",
  announceList: [],
  private: false,
  pieceLength: 2 ** 18,
}, (err, torrentBuf) => {
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
  console.log(`  Piece length: ${(parsed.pieceLength ?? 0) / 1024}KB`);

  // Also write out the magnet URI for easy reference
  fs.writeFileSync(outputPath.replace(".torrent", ".magnet.txt"), parseTorrent.toMagnetURI(parsed));
  console.log(`  Magnet saved to: ${outputPath.replace(".torrent", ".magnet.txt")}`);
});
