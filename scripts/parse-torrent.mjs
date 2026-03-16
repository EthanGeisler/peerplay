import parseTorrent from "parse-torrent";
import { toMagnetURI } from "parse-torrent";
import fs from "node:fs";

const torrentPath = process.argv[2];
const buf = fs.readFileSync(torrentPath);
const parsed = await parseTorrent(buf);

console.log("Info hash:", parsed.infoHash);
console.log("Name:", parsed.name);
console.log("Files:", parsed.files?.length);
parsed.files?.forEach(f => console.log(`  ${f.name} (${(f.length / 1024 / 1024).toFixed(1)}MB)`));
console.log("Piece length:", (parsed.pieceLength ?? 0) / 1024, "KB");
console.log("Total size:", ((parsed.length ?? 0) / 1024 / 1024).toFixed(1), "MB");

const magnet = toMagnetURI(parsed);
console.log("\nMagnet URI:", magnet);

fs.writeFileSync(torrentPath.replace(".torrent", ".magnet.txt"), magnet);
console.log("Saved to:", torrentPath.replace(".torrent", ".magnet.txt"));
