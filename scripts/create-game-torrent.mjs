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
  name: path.basename(absPath),
  comment: "Player Character 01 — A 2D platformer with world-hopping portals. Published on BoilerDeck.",
  createdBy: "BoilerDeck v0.1.0",
  announceList: [
    ["udp://tracker.opentrackr.org:1337/announce"],
    ["udp://open.tracker.cl:1337/announce"],
    ["udp://open.demonii.com:1339/announce"],
    ["udp://open.stealth.si:80/announce"],
    ["udp://tracker.torrent.eu.org:451/announce"],
    ["udp://exodus.desync.com:6969/announce"],
    ["wss://tracker.openwebtorrent.com"],
    ["wss://tracker.webtorrent.dev"],
    ["wss://tracker.btorrent.xyz"],
  ],
  private: false,
  pieceLength: 2 ** 18,
}, async (err, torrentBuf) => {
  if (err) {
    console.error("Error creating torrent:", err);
    process.exit(1);
  }

  fs.writeFileSync(outputPath, torrentBuf);

  // Use parse-torrent script for magnet URI generation
  const parsed = await parseTorrent(torrentBuf);
  const { toMagnetURI } = await import("parse-torrent");
  const magnetURI = toMagnetURI(parsed);
  console.log("\nTorrent created successfully!");
  console.log(`  File: ${outputPath}`);
  console.log(`  Info hash: ${parsed.infoHash}`);
  console.log(`  Magnet URI: ${magnetURI}`);
  console.log(`  Piece length: ${(parsed.pieceLength ?? 0) / 1024}KB`);

  // Also write out the magnet URI for easy reference
  fs.writeFileSync(outputPath.replace(".torrent", ".magnet.txt"), magnetURI);
  console.log(`  Magnet saved to: ${outputPath.replace(".torrent", ".magnet.txt")}`);
});
