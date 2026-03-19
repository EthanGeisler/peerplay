import createTorrent from "create-torrent";
import parseTorrent, { toMagnetURI } from "parse-torrent";
import fs from "node:fs";
import path from "node:path";

// --- Parse arguments ---
const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: node scripts/create-installer-torrent.mjs <path-to-installer> [--output <dir>]

Generates a .torrent file for a BoilerDeck desktop client installer.

Arguments:
  <path-to-installer>  Path to the installer file (.exe or .AppImage)
  --output <dir>       Directory to write the .torrent file (default: same as input)

Example:
  node scripts/create-installer-torrent.mjs "client/release/BoilerDeck Setup 0.3.1.exe"
  node scripts/create-installer-torrent.mjs "client/release/BoilerDeck-0.3.1.AppImage" --output dist/`);
  process.exit(0);
}

const filePath = args[0];
let outputDir = null;

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--output" && args[i + 1]) {
    outputDir = args[i + 1];
    i++;
  }
}

// --- Validate input ---
const absPath = path.resolve(filePath);

if (!fs.existsSync(absPath)) {
  console.error(`Error: File not found: ${absPath}`);
  process.exit(1);
}

const stat = fs.statSync(absPath);
if (!stat.isFile()) {
  console.error(`Error: Not a file: ${absPath}`);
  process.exit(1);
}

const ext = path.extname(absPath).toLowerCase();
if (![".exe", ".appimage"].includes(ext)) {
  console.warn(`Warning: Expected .exe or .AppImage, got "${ext}". Continuing anyway.`);
}

// --- Determine output path ---
const resolvedOutputDir = outputDir ? path.resolve(outputDir) : path.dirname(absPath);
if (!fs.existsSync(resolvedOutputDir)) {
  fs.mkdirSync(resolvedOutputDir, { recursive: true });
}
const torrentOutPath = path.join(resolvedOutputDir, path.basename(absPath) + ".torrent");

// --- Create torrent ---
console.log(`Creating torrent for: ${absPath}`);
console.log(`File size: ${(stat.size / (1024 * 1024)).toFixed(1)} MB`);

createTorrent(absPath, {
  name: path.basename(absPath),
  comment: "BoilerDeck Desktop Client - https://boilerdeck.com",
  createdBy: "BoilerDeck",
  announceList: [
    ["udp://tracker.opentrackr.org:1337/announce"],
    ["udp://open.stealth.si:80/announce"],
    ["udp://tracker.torrent.eu.org:451/announce"],
  ],
  private: false,
}, async (err, torrentBuf) => {
  if (err) {
    console.error("Error creating torrent:", err);
    process.exit(1);
  }

  fs.writeFileSync(torrentOutPath, torrentBuf);

  const parsed = await parseTorrent(torrentBuf);
  const magnetURI = toMagnetURI(parsed);

  console.log("\nTorrent created successfully!");
  console.log(`  Output:       ${torrentOutPath}`);
  console.log(`  Info hash:    ${parsed.infoHash}`);
  console.log(`  Piece length: ${((parsed.pieceLength ?? 0) / 1024).toFixed(0)} KB`);
  console.log(`  Pieces:       ${parsed.pieces?.length ?? "unknown"}`);
  console.log(`  Magnet URI:   ${magnetURI}`);
});
