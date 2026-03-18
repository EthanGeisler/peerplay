// Service
export { storeEvent, getEvent, queryEvents, deleteEvent } from "./service.js";
export type { DeleteResult } from "./service.js";

// Routes
export { relayRouter, nip11Router } from "./routes.js";

// WebSocket
export { attachRelayWebSocket, fanOutEvent } from "./ws.js";

// Crypto (re-exports for relay consumers)
export {
  createEvent,
  verifyEvent,
  hashEvent,
  serializeEvent,
} from "./crypto.js";

// Federation
export {
  initFederation,
  federateOutbound,
  shutdownFederation,
  getFederationStatus,
  getExternalRelayUrls,
  isImported,
} from "./federation.js";

// Types
export type {
  RelayEvent,
  EventFilter,
  Subscription,
  ClientMessage,
  ClientReqMessage,
  ClientEventMessage,
  ClientCloseMessage,
  RelayMessage,
  RelayEventMessage,
  RelayEoseMessage,
  RelayOkMessage,
  RelayNoticeMessage,
} from "./types.js";
