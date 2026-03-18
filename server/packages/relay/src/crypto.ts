/**
 * Relay crypto utilities — re-exports from shared and auth packages.
 *
 * The relay package needs sign/verify for event handling and federation.
 * Rather than duplicating crypto code, we re-export the canonical implementations
 * from @boilerdeck/shared (event-level ops) and @boilerdeck/auth (key-level ops).
 */

// Event-level crypto (sign events, verify events, hash events)
export {
  createEvent,
  verifyEvent,
  hashEvent,
  serializeEvent,
} from "@boilerdeck/shared";

export type { SignedEvent, UnsignedEvent } from "@boilerdeck/shared";

// Key-level crypto (generate keypairs, Schnorr primitives)
export {
  generateKeypair,
  generateMnemonic,
  mnemonicToKeypair,
  schnorrSign,
  schnorrVerify,
  pubkeyHex,
} from "@boilerdeck/auth";
