import * as os from "os";
import * as crypto from "crypto";
import { storeGet, storeSet } from "./store.js";

let cachedFingerprint: string | null = null;

export function getDeviceFingerprint(): string {
  if (cachedFingerprint) return cachedFingerprint;

  // Try to load a previously generated fingerprint
  const stored = storeGet("deviceFingerprint") as string | null;
  if (stored) {
    cachedFingerprint = stored;
    return stored;
  }

  // Generate from hardware identifiers
  const parts = [
    os.hostname(),
    os.cpus()[0]?.model ?? "unknown-cpu",
    os.arch(),
    os.platform(),
    os.totalmem().toString(),
  ];

  const hash = crypto
    .createHash("sha256")
    .update(parts.join("|"))
    .digest("hex");

  cachedFingerprint = hash;
  storeSet("deviceFingerprint", hash);
  return hash;
}
