import * as https from "node:https";
import * as http from "node:http";
import type { PrivacySettings } from "./store.js";

const TOR_PROXY_URL = "socks5h://127.0.0.1:9150";
const TEST_URL = "https://boilerdeck.com/api/health";
const TEST_TIMEOUT_MS = 10_000;

// Dynamic import to avoid CJS require() of ESM-only socks-proxy-agent inside asar
async function createSocksProxyAgent(url: string): Promise<http.Agent> {
  const { SocksProxyAgent } = await import("socks-proxy-agent");
  return new SocksProxyAgent(url) as unknown as http.Agent;
}

/**
 * Returns an http.Agent configured for the active proxy, or undefined if off.
 * Uses socks5h:// so DNS resolves through the proxy (important for Tor).
 */
export async function getProxyAgent(settings: PrivacySettings): Promise<http.Agent | undefined> {
  if (settings.mode === "off") {
    return undefined;
  }

  if (settings.mode === "tor") {
    return createSocksProxyAgent(TOR_PROXY_URL);
  }

  // socks5 mode — build URL with optional auth
  const { socksHost, socksPort, socksUsername, socksPassword } = settings;
  let proxyUrl: string;

  if (socksUsername && socksPassword) {
    const encodedUser = encodeURIComponent(socksUsername);
    const encodedPass = encodeURIComponent(socksPassword);
    proxyUrl = `socks5h://${encodedUser}:${encodedPass}@${socksHost}:${socksPort}`;
  } else {
    proxyUrl = `socks5h://${socksHost}:${socksPort}`;
  }

  return createSocksProxyAgent(proxyUrl);
}

interface TestSuccess {
  success: true;
  latencyMs: number;
  ip?: string;
}

interface TestFailure {
  success: false;
  error: string;
}

type TestResult = TestSuccess | TestFailure;

/**
 * Tests the proxy connection by fetching the health endpoint through it.
 * Never throws — all errors are caught and returned as failure objects.
 */
export async function testProxyConnection(settings: PrivacySettings): Promise<TestResult> {
  if (settings.mode === "off") {
    return { success: false, error: "Proxy mode is off — nothing to test" };
  }

  let agent: http.Agent;
  try {
    const maybeAgent = await getProxyAgent(settings);
    if (!maybeAgent) {
      return { success: false, error: "Failed to create proxy agent" };
    }
    agent = maybeAgent;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to create proxy agent: ${message}` };
  }

  const startTime = Date.now();

  return new Promise<TestResult>((resolve) => {
    const req = https.request(TEST_URL, { agent, timeout: TEST_TIMEOUT_MS, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];

      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on("end", () => {
        const latencyMs = Date.now() - startTime;
        const statusCode = res.statusCode ?? 0;

        if (statusCode >= 200 && statusCode < 400) {
          let ip: string | undefined;
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            if (body.ip && typeof body.ip === "string") {
              ip = body.ip;
            }
          } catch {
            // Body parse failure is fine — we still connected successfully
          }
          resolve({ success: true, latencyMs, ip });
        } else {
          resolve({ success: false, error: `Health endpoint returned HTTP ${statusCode}` });
        }
      });

      res.on("error", (err) => {
        resolve({ success: false, error: `Response error: ${err.message}` });
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ success: false, error: `Connection timed out after ${TEST_TIMEOUT_MS}ms` });
    });

    req.on("error", (err: NodeJS.ErrnoException) => {
      const latencyMs = Date.now() - startTime;

      if (err.code === "ECONNREFUSED") {
        resolve({ success: false, error: `Connection refused — is the proxy running? (${latencyMs}ms)` });
      } else if (err.code === "ENOTFOUND") {
        resolve({ success: false, error: `Proxy host not found — check the hostname` });
      } else if (err.code === "ETIMEDOUT") {
        resolve({ success: false, error: `Connection timed out — proxy may be unreachable` });
      } else if (err.message.includes("Socks5 Authentication failed")) {
        resolve({ success: false, error: `SOCKS5 authentication failed — check username/password` });
      } else {
        resolve({ success: false, error: err.message });
      }
    });

    req.end();
  });
}
