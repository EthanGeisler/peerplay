/**
 * Local HTTP server for streaming media files (video, audio) with Content-Range support.
 * The Electron renderer can point an HTML5 <video> or <audio> element at this server.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";

let server: http.Server | null = null;
let serverPort = 0;
let servingDir = "";

const MIME_MAP: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
};

export function startMediaServer(dir: string): Promise<{ port: number }> {
  if (server) {
    // Already running — just update the directory
    servingDir = dir;
    return Promise.resolve({ port: serverPort });
  }

  servingDir = dir;

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      if (!req.url || req.url === "/") {
        res.writeHead(400);
        res.end("Bad request");
        return;
      }

      // Decode and sanitize the path to prevent directory traversal
      const decoded = decodeURIComponent(req.url.replace(/^\//, ""));
      if (decoded.includes("..")) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      const filePath = path.join(servingDir, decoded);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_MAP[ext] || "application/octet-stream";

      fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const total = stat.size;
        const range = req.headers.range;

        if (range) {
          // Parse Range header (e.g., "bytes=0-1023")
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : total - 1;

          if (start >= total || end >= total || start > end) {
            res.writeHead(416, { "Content-Range": `bytes */${total}` });
            res.end();
            return;
          }

          res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Accept-Ranges": "bytes",
            "Content-Length": end - start + 1,
            "Content-Type": contentType,
          });

          fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
          res.writeHead(200, {
            "Content-Length": total,
            "Content-Type": contentType,
            "Accept-Ranges": "bytes",
          });

          fs.createReadStream(filePath).pipe(res);
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      if (addr && typeof addr === "object") {
        serverPort = addr.port;
        console.log(`[mediaServer] Listening on http://127.0.0.1:${serverPort}`);
        resolve({ port: serverPort });
      } else {
        reject(new Error("Failed to get server address"));
      }
    });

    server.on("error", reject);
  });
}

export function stopMediaServer(): void {
  if (server) {
    server.close();
    server = null;
    serverPort = 0;
    servingDir = "";
  }
}

export function getMediaFileUrl(dir: string, fileName: string): string {
  if (!server) {
    throw new Error("Media server not running");
  }
  // Update serving directory if it changed
  servingDir = dir;
  return `http://127.0.0.1:${serverPort}/${encodeURIComponent(fileName)}`;
}
