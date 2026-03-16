import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";

const runningGames = new Map<string, ChildProcess>();

export interface LaunchOpts {
  gameId: string;
  installPath: string;
  exePath: string;
}

export function launchGame(opts: LaunchOpts): { success: boolean; error?: string } {
  const fullExe = path.join(opts.installPath, opts.exePath);

  if (!fs.existsSync(fullExe)) {
    return { success: false, error: `Executable not found: ${fullExe}` };
  }

  // Don't launch the same game twice
  const existing = runningGames.get(opts.gameId);
  if (existing && !existing.killed) {
    return { success: false, error: "Game is already running" };
  }

  const child = spawn(fullExe, [], {
    detached: true,
    cwd: opts.installPath,
    stdio: "ignore",
  });

  child.unref();

  child.on("exit", () => {
    runningGames.delete(opts.gameId);
  });

  child.on("error", (err) => {
    console.error(`[launcher] Failed to launch ${opts.exePath}:`, err.message);
    runningGames.delete(opts.gameId);
  });

  runningGames.set(opts.gameId, child);
  return { success: true };
}

export function isGameRunning(gameId: string): boolean {
  const proc = runningGames.get(gameId);
  return !!proc && !proc.killed;
}

export async function uninstallGame(installPath: string): Promise<{ success: boolean; error?: string }> {
  try {
    await fs.promises.rm(installPath, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
}
