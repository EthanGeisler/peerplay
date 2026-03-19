import fs from "node:fs/promises";
import path from "node:path";
import { db, NotFoundError, ForbiddenError, getConfig } from "@boilerdeck/shared";
import { createGameTorrent } from "@boilerdeck/torrent";
import { Open as unzipOpen } from "unzipper";

// ── Game directory scanning ─────────────────────────────────────────────────

export async function listGameDirectories() {
  const gamesDir = getConfig().GAMES_DIR;

  try {
    const entries = await fs.readdir(gamesDir, { withFileTypes: true });
    const dirs: { name: string; files: string[] }[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(gamesDir, entry.name);
      const files = await fs.readdir(dirPath);
      dirs.push({ name: entry.name, files });
    }

    return dirs;
  } catch {
    return [];
  }
}

export async function detectExecutable(dirname: string) {
  const gamesDir = getConfig().GAMES_DIR;

  // Prevent path traversal
  if (dirname.includes("..") || dirname.includes("/") || dirname.includes("\\")) {
    throw new ForbiddenError("Invalid directory name");
  }

  const dirPath = path.join(gamesDir, dirname);

  try {
    await fs.access(dirPath);
  } catch {
    throw new NotFoundError("Game directory");
  }

  // Recursively find all .exe files (uploads may nest files in subdirectories)
  const exeFiles: string[] = [];
  async function walk(dir: string, prefix: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel);
      } else if (entry.name.endsWith(".exe")) {
        exeFiles.push(rel);
      }
    }
  }
  await walk(dirPath, "");

  // Prefer non-console executables
  const mainExe = exeFiles.find((f) => !f.includes(".console.")) ?? exeFiles[0] ?? null;

  return { directory: dirname, executables: exeFiles, recommended: mainExe };
}

export async function autoDetectAndSetExe(
  gameId: string,
  developerId: string,
  dirname: string,
) {
  const game = await db.listing.findUnique({ where: { id: gameId } });
  if (!game) throw new NotFoundError("Listing");
  if (game.developerId !== developerId) {
    throw new ForbiddenError("You can only update your own listings");
  }

  const result = await detectExecutable(dirname);
  if (!result.recommended) {
    throw new NotFoundError("No executable found in directory");
  }

  const updated = await db.listing.update({
    where: { id: gameId },
    data: { exePath: result.recommended },
  });

  return { exePath: updated.exePath, detected: result };
}

// ── Upload & Processing ─────────────────────────────────────────────────────

async function getDirectorySize(dirPath: string): Promise<bigint> {
  let total = BigInt(0);
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySize(fullPath);
    } else {
      const stat = await fs.stat(fullPath);
      total += BigInt(stat.size);
    }
  }
  return total;
}

export async function uploadAndProcessVersion(
  gameId: string,
  developerId: string,
  versionId: string,
  zipPath: string,
) {
  // 1. Verify ownership and version status
  const game = await db.listing.findUnique({ where: { id: gameId } });
  if (!game) throw new NotFoundError("Listing");
  if (game.developerId !== developerId) {
    throw new ForbiddenError("You can only upload to your own listings");
  }

  const version = await db.listingVersion.findUnique({ where: { id: versionId } });
  if (!version || version.gameId !== gameId) {
    throw new NotFoundError("Version");
  }
  if (version.status !== "PROCESSING") {
    throw new ForbiddenError("Version is not in PROCESSING state");
  }

  const gamesDir = getConfig().GAMES_DIR;
  const extractDir = path.join(gamesDir, game.slug);

  try {
    // 2. Extract zip
    await fs.mkdir(extractDir, { recursive: true });
    const directory = await unzipOpen.file(zipPath);
    await directory.extract({ path: extractDir });

    // 3. Calculate total file size
    const fileSizeBytes = await getDirectorySize(extractDir);

    // 4. Auto-detect exe (only for GAME and SOFTWARE content types)
    let detectedExe: string | null = null;
    if (game.contentType === "GAME" || game.contentType === "SOFTWARE") {
      try {
        const result = await detectExecutable(game.slug);
        detectedExe = result.recommended;
      } catch {
        // Non-fatal — exe detection is best-effort
      }
    }

    // 5. Create torrent
    const { torrentBuffer, infoHash, magnetUri } = await createGameTorrent(
      extractDir,
      game.slug,
    );

    // 6. Create Torrent DB record + update version in a transaction
    const updatedVersion = await db.$transaction(async (tx) => {
      const torrent = await tx.torrent.create({
        data: {
          infoHash,
          magnetUri,
          torrentFile: new Uint8Array(torrentBuffer),
        },
      });

      const ver = await tx.listingVersion.update({
        where: { id: versionId },
        data: {
          torrentId: torrent.id,
          fileSizeBytes,
          status: "READY",
        },
        include: {
          torrent: {
            select: { id: true, infoHash: true, magnetUri: true, createdAt: true },
          },
        },
      });

      // 8. Auto-set exePath if listing doesn't have one (GAME/SOFTWARE only)
      if (!game.exePath && detectedExe && (game.contentType === "GAME" || game.contentType === "SOFTWARE")) {
        await tx.listing.update({
          where: { id: gameId },
          data: { exePath: detectedExe },
        });
      }

      return ver;
    });

    // 9. Add to Transmission (non-blocking, failure is non-fatal)
    addToTransmission(torrentBuffer).catch((err) => {
      console.warn("Failed to add torrent to Transmission:", err);
    });

    // 10. Clean up the temp zip
    await fs.unlink(zipPath).catch(() => {});

    return {
      id: updatedVersion.id,
      version: updatedVersion.version,
      status: updatedVersion.status,
      fileSizeBytes: Number(updatedVersion.fileSizeBytes),
      torrent: updatedVersion.torrent,
    };
  } catch (err) {
    // On any error, mark version as FAILED
    await db.listingVersion.update({
      where: { id: versionId },
      data: { status: "FAILED" },
    }).catch(() => {});

    // Clean up temp zip
    await fs.unlink(zipPath).catch(() => {});

    throw err;
  }
}

async function addToTransmission(torrentBuffer: Buffer): Promise<void> {
  const rpcUrl = getConfig().TRANSMISSION_RPC_URL;
  const gamesDir = getConfig().GAMES_DIR;
  const body = JSON.stringify({
    method: "torrent-add",
    arguments: {
      "metainfo": torrentBuffer.toString("base64"),
      "download-dir": gamesDir,
    },
  });

  console.log(`[transmission] Adding torrent to ${rpcUrl}, download-dir: ${gamesDir}`);

  // First attempt — will get 409 with session ID
  const first = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  let response: Response;

  if (first.status === 409) {
    const sessionId = first.headers.get("X-Transmission-Session-Id") ?? "";
    if (!sessionId) throw new Error("Transmission returned 409 but no session ID");

    // Retry with session ID
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Transmission-Session-Id": sessionId,
      },
      body,
    });
  } else {
    response = first;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Transmission RPC HTTP ${response.status}: ${text}`);
  }

  const result = await response.json() as { result: string; arguments?: Record<string, unknown> };
  if (result.result !== "success") {
    throw new Error(`Transmission RPC failed: ${result.result}`);
  }

  console.log("[transmission] Torrent added successfully:", JSON.stringify(result.arguments));
}
