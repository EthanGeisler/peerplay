// Service
export { storeEvent, getEvent, queryEvents, deleteEvent } from "./service.js";
export type { DeleteResult } from "./service.js";

// Routes
export { relayRouter, nip11Router } from "./routes.js";

// WebSocket
export { attachRelayWebSocket, fanOutEvent, setConnectionUser, getConnectionIds } from "./ws.js";

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

// Kind definitions and validation
export {
  KIND_PROFILE,
  KIND_TEXT_NOTE,
  KIND_FOLLOW_LIST,
  KIND_DELETION,
  KIND_REACTION,
  KIND_REVIEW,
  KIND_ATTESTATION,
  SUPPORTED_KINDS,
  ATTESTATION_FUTURE_LIMIT_SECONDS,
  validateEventKind,
  kindName,
  isSupportedKind,
} from "./kinds.js";
export type { ValidationResult } from "./kinds.js";

// Async attestation validation
export { validateAttestationAsync } from "./attestationValidation.js";

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
