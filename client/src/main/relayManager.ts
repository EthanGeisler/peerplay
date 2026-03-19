/**
 * Relay connection manager for the Electron client.
 *
 * Manages WebSocket connections to Nostr-compatible relays.
 * Features:
 * - Auto-reconnect with exponential backoff (1s, 2s, 4s, max 30s)
 * - Re-sends active subscriptions on reconnect
 * - IPC-driven: connect/disconnect/subscribe/publish from renderer
 */

import WebSocket from "ws";
import type { BrowserWindow } from "electron";

// ─── Types ──────────────────────────────────────────────────────────

export interface RelayEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

interface SubscriptionFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  "#e"?: string[];
  "#p"?: string[];
  since?: number;
  until?: number;
  limit?: number;
}

// ─── State ──────────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let mainWindow: BrowserWindow | null = null;
let relayUrl: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let intentionalClose = false;

const MAX_RECONNECT_DELAY = 30000; // 30s
const BASE_RECONNECT_DELAY = 1000; // 1s

/** Active subscriptions — preserved across reconnects. */
const subscriptions = new Map<string, SubscriptionFilter[]>();

// ─── Public API ────────────────────────────────────────────────────

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

export function connect(url: string): { success: boolean; error?: string } {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return { success: true };
  }

  relayUrl = url;
  intentionalClose = false;
  reconnectAttempts = 0;

  try {
    createConnection();
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function disconnect(): { success: boolean } {
  intentionalClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  subscriptions.clear();
  relayUrl = null;
  reconnectAttempts = 0;
  return { success: true };
}

export function subscribe(
  subId: string,
  filters: SubscriptionFilter[],
): { success: boolean; error?: string } {
  subscriptions.set(subId, filters);

  if (ws && ws.readyState === WebSocket.OPEN) {
    const msg = JSON.stringify(["REQ", subId, ...filters]);
    ws.send(msg);
    return { success: true };
  }

  // Subscription stored — will be sent on next connect/reconnect
  return { success: true };
}

export function unsubscribe(subId: string): { success: boolean } {
  subscriptions.delete(subId);

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(["CLOSE", subId]));
  }

  return { success: true };
}

export function publish(event: RelayEvent): { success: boolean; error?: string } {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return { success: false, error: "Not connected to relay" };
  }

  ws.send(JSON.stringify(["EVENT", event]));
  return { success: true };
}

export function getStatus(): {
  connected: boolean;
  url: string | null;
  subscriptionCount: number;
} {
  return {
    connected: ws?.readyState === WebSocket.OPEN || false,
    url: relayUrl,
    subscriptionCount: subscriptions.size,
  };
}

// ─── Internal ──────────────────────────────────────────────────────

function createConnection(): void {
  if (!relayUrl) return;

  ws = new WebSocket(relayUrl);

  ws.on("open", () => {
    console.log("[relay] Connected to", relayUrl);
    reconnectAttempts = 0;

    // Re-send all active subscriptions
    for (const [subId, filters] of subscriptions) {
      ws!.send(JSON.stringify(["REQ", subId, ...filters]));
    }
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (!Array.isArray(msg) || msg.length < 1) return;

      const type = msg[0];

      if (type === "EVENT" && msg.length >= 3) {
        // ["EVENT", subId, event]
        const subId = msg[1] as string;
        const event = msg[2] as RelayEvent;
        mainWindow?.webContents.send("relay:on-event", { subId, event });
      } else if (type === "EOSE" && msg.length >= 2) {
        // ["EOSE", subId]
        mainWindow?.webContents.send("relay:on-eose", { subId: msg[1] });
      } else if (type === "OK" && msg.length >= 4) {
        // ["OK", eventId, success, message]
        mainWindow?.webContents.send("relay:on-ok", {
          eventId: msg[1],
          success: msg[2],
          message: msg[3],
        });
      } else if (type === "NOTICE") {
        console.log("[relay] NOTICE:", msg[1]);
        mainWindow?.webContents.send("relay:on-notice", { message: msg[1] });
      }
    } catch {
      // Ignore unparseable messages
    }
  });

  ws.on("close", () => {
    console.log("[relay] Connection closed");
    ws = null;

    if (!intentionalClose && relayUrl) {
      scheduleReconnect();
    }
  });

  ws.on("error", (err) => {
    console.error("[relay] WebSocket error:", err.message);
    // close event will fire after error, triggering reconnect
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;

  const delay = Math.min(
    BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
    MAX_RECONNECT_DELAY,
  );
  reconnectAttempts++;

  console.log(`[relay] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    createConnection();
  }, delay);
}
