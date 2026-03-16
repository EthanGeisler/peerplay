import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

interface DecryptOpts {
  installPath: string;
  key: string;
  algorithm: string;
}

/**
 * Decrypts all encrypted game files in the install directory.
 * Encrypted files have a .enc extension and a 16-byte IV prepended.
 * After decryption, the .enc file is replaced with the decrypted original.
 */
export async function decryptGameFiles(opts: DecryptOpts): Promise<{ success: boolean; error?: string }> {
  try {
    const keyBuffer = Buffer.from(opts.key, "hex");
    const files = await findEncryptedFiles(opts.installPath);

    if (files.length === 0) {
      return { success: true }; // Nothing to decrypt
    }

    for (const encFile of files) {
      await decryptFile(encFile, keyBuffer, opts.algorithm);
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Decryption failed";
    return { success: false, error: message };
  }
}

async function findEncryptedFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findEncryptedFiles(fullPath);
      results.push(...nested);
    } else if (entry.name.endsWith(".enc")) {
      results.push(fullPath);
    }
  }

  return results;
}

async function decryptFile(encFilePath: string, key: Buffer, algorithm: string): Promise<void> {
  const data = await fs.promises.readFile(encFilePath);

  // First 16 bytes are the IV
  const iv = data.subarray(0, 16);
  const encrypted = data.subarray(16);

  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  // Write decrypted file without .enc extension
  const originalPath = encFilePath.replace(/\.enc$/, "");
  await fs.promises.writeFile(originalPath, decrypted);
  await fs.promises.unlink(encFilePath);
}
