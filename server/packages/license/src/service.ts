import { db, NotFoundError, ForbiddenError, getConfig } from "@peerplay/shared";
import { unwrapKey, deriveUserKey, wrapKey } from "./crypto.js";
import { randomBytes } from "node:crypto";

const MAX_DEVICES_PER_LICENSE = 3;

export async function listUserLicenses(userId: string) {
  const licenses = await db.license.findMany({
    where: { userId },
    include: {
      game: {
        select: {
          id: true,
          slug: true,
          title: true,
          coverImageUrl: true,
          drmTier: true,
          developer: { select: { studioName: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return licenses.map((l) => ({
    id: l.id,
    status: l.status,
    createdAt: l.createdAt,
    game: {
      id: l.game.id,
      slug: l.game.slug,
      title: l.game.title,
      coverImageUrl: l.game.coverImageUrl,
      drmTier: l.game.drmTier,
      studioName: l.game.developer.studioName,
    },
  }));
}

export async function verifyLicense(
  userId: string,
  gameId: string,
  deviceFingerprint?: string,
) {
  const game = await db.game.findUnique({ where: { id: gameId } });
  if (!game) {
    throw new NotFoundError("Game");
  }

  // DRM tier NONE — no enforcement needed
  if (game.drmTier === "NONE") {
    const license = await db.license.findUnique({
      where: { userId_gameId: { userId, gameId } },
    });
    return {
      valid: !!(license && license.status === "ACTIVE"),
      drmTier: game.drmTier,
    };
  }

  // LIGHT or ENCRYPTED — license must exist and be ACTIVE
  const license = await db.license.findUnique({
    where: { userId_gameId: { userId, gameId } },
  });

  if (!license || license.status !== "ACTIVE") {
    return {
      valid: false,
      drmTier: game.drmTier,
      devicesUsed: 0,
      maxDevices: MAX_DEVICES_PER_LICENSE,
    };
  }

  // Device fingerprint tracking
  let devicesUsed = license.deviceFingerprints.length;
  if (deviceFingerprint) {
    const alreadyRegistered = license.deviceFingerprints.includes(deviceFingerprint);
    if (!alreadyRegistered) {
      if (devicesUsed >= MAX_DEVICES_PER_LICENSE) {
        return {
          valid: false,
          drmTier: game.drmTier,
          devicesUsed,
          maxDevices: MAX_DEVICES_PER_LICENSE,
          reason: "DEVICE_LIMIT_REACHED",
        };
      }
      // Register new device
      await db.license.update({
        where: { id: license.id },
        data: {
          deviceFingerprints: [...license.deviceFingerprints, deviceFingerprint],
        },
      });
      devicesUsed += 1;
    }
  }

  return {
    valid: true,
    drmTier: game.drmTier,
    devicesUsed,
    maxDevices: MAX_DEVICES_PER_LICENSE,
  };
}

export async function removeDevice(
  userId: string,
  gameId: string,
  fingerprint: string,
) {
  const license = await db.license.findUnique({
    where: { userId_gameId: { userId, gameId } },
  });
  if (!license) {
    throw new NotFoundError("License");
  }
  if (license.userId !== userId) {
    throw new ForbiddenError("You do not own this license");
  }

  const updated = license.deviceFingerprints.filter((fp) => fp !== fingerprint);
  await db.license.update({
    where: { id: license.id },
    data: { deviceFingerprints: updated },
  });

  return { removed: fingerprint, devicesUsed: updated.length };
}

export async function getDecryptionKey(
  userId: string,
  gameId: string,
  deviceFingerprint?: string,
) {
  const game = await db.game.findUnique({ where: { id: gameId } });
  if (!game) {
    throw new NotFoundError("Game");
  }
  if (game.drmTier !== "ENCRYPTED") {
    throw new ForbiddenError("This game does not use encrypted DRM");
  }

  const license = await db.license.findUnique({
    where: { userId_gameId: { userId, gameId } },
  });
  if (!license || license.status !== "ACTIVE") {
    throw new ForbiddenError("You do not own a valid license for this game");
  }

  // Validate device fingerprint if provided (same logic as verify)
  if (deviceFingerprint) {
    const alreadyRegistered = license.deviceFingerprints.includes(deviceFingerprint);
    if (!alreadyRegistered && license.deviceFingerprints.length >= MAX_DEVICES_PER_LICENSE) {
      throw new ForbiddenError("Device limit reached");
    }
    if (!alreadyRegistered) {
      await db.license.update({
        where: { id: license.id },
        data: {
          deviceFingerprints: [...license.deviceFingerprints, deviceFingerprint],
        },
      });
    }
  }

  const config = getConfig();
  if (!config.DRM_MASTER_KEK) {
    throw new Error("DRM_MASTER_KEK not configured");
  }
  const kek = Buffer.from(config.DRM_MASTER_KEK, "hex");

  // If per-user key already generated and stored on the license, unwrap it
  if (license.decryptionKeyEnc) {
    const userKey = unwrapKey(Buffer.from(license.decryptionKeyEnc), kek);
    return {
      key: userKey.toString("hex"),
      algorithm: "aes-256-ctr",
    };
  }

  // Otherwise derive a new per-user key from the game's master key
  const encryptionKey = await db.encryptionKey.findUnique({
    where: { gameId },
  });
  if (!encryptionKey) {
    throw new NotFoundError("EncryptionKey");
  }

  const masterKey = unwrapKey(Buffer.from(encryptionKey.masterKeyEnc), kek);
  const userKey = deriveUserKey(masterKey, userId);

  // Wrap and store the per-user key on the license
  const wrappedUserKey = wrapKey(userKey, kek);
  await db.license.update({
    where: { id: license.id },
    data: { decryptionKeyEnc: new Uint8Array(wrappedUserKey) },
  });

  // Generate a random IV for the user's decryption
  const iv = randomBytes(16);

  return {
    key: userKey.toString("hex"),
    algorithm: "aes-256-ctr",
    iv: iv.toString("hex"),
  };
}
