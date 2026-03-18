import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { db, redis, getConfig, ConflictError, UnauthorizedError, NotFoundError, ValidationError } from "@boilerdeck/shared";
import type { JwtPayload } from "@boilerdeck/shared";
import type { RegisterInput, LoginInput, PubkeyLoginInput, ChangePasswordInput } from "./schemas.js";
import { generateKeypair, encryptPrivateKey, encryptMnemonic, decryptPrivateKey, decryptMnemonic, schnorrVerify, pubkeyHex, pubkeyToNpub, privkeyToNsec } from "./crypto.js";

const SALT_ROUNDS = 12;

function encryptForCache(data: Uint8Array, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return nonce.toString("hex") + ":" + tag.toString("hex") + ":" + encrypted.toString("hex");
}

function getRefreshTtlSeconds(): number {
  const config = getConfig();
  const match = config.JWT_REFRESH_EXPIRES_IN.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60;
  const [, num, unit] = match;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return parseInt(num!) * multipliers[unit!]!;
}

function generateAccessToken(user: { id: string; email: string; role: string; nostrPubkey?: string | null }): string {
  const config = getConfig();
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, ...(user.nostrPubkey ? { pubkey: user.nostrPubkey } : {}) },
    config.JWT_ACCESS_SECRET,
    { expiresIn: config.JWT_ACCESS_EXPIRES_IN as unknown as jwt.SignOptions["expiresIn"] },
  );
}

function generateRefreshToken(): string {
  return crypto.randomBytes(40).toString("hex");
}

function getRefreshExpiresAt(): Date {
  const config = getConfig();
  const match = config.JWT_REFRESH_EXPIRES_IN.match(/^(\d+)([smhd])$/);
  if (!match) return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const [, num, unit] = match;
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return new Date(Date.now() + parseInt(num!) * multipliers[unit!]!);
}

export async function register(input: RegisterInput) {
  const existing = await db.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ConflictError("Email already registered");
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await db.user.create({
    data: {
      email: input.email,
      passwordHash,
      displayName: input.displayName,
    },
  });

  let nostrPubkey: string;
  let mnemonic: string | undefined;

  if (input.pubkey) {
    // Self-custody path: client generated the keypair, we only store the pubkey
    nostrPubkey = input.pubkey;
    await db.user.update({
      where: { id: user.id },
      data: {
        nostrPubkey: input.pubkey,
        encryptedNsec: null,
        encryptedMnemonic: null,
        custodyMode: "SELF_CUSTODY",
      },
    });
  } else {
    // Custodial path: server generates keypair, encrypts with user's password
    const keypair = generateKeypair();
    nostrPubkey = pubkeyHex(keypair.publicKey);
    mnemonic = keypair.mnemonic;

    const encryptedNsec = encryptPrivateKey(keypair.privateKey, input.password);
    const encryptedMnemonicValue = encryptMnemonic(keypair.mnemonic, input.password);

    await db.user.update({
      where: { id: user.id },
      data: {
        nostrPubkey,
        encryptedNsec,
        encryptedMnemonic: encryptedMnemonicValue,
        custodyMode: "CUSTODIAL",
      },
    });
  }

  const accessToken = generateAccessToken({ ...user, nostrPubkey });
  const refreshToken = generateRefreshToken();

  await db.refreshToken.create({
    data: {
      userId: user.id,
      token: refreshToken,
      expiresAt: getRefreshExpiresAt(),
    },
  });

  return {
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, nostrPubkey },
    accessToken,
    refreshToken,
    ...(mnemonic ? { mnemonic } : {}),
  };
}

export async function login(input: LoginInput) {
  const user = await db.user.findUnique({ where: { email: input.email } });
  if (!user) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError("Invalid email or password");
  }

  let mnemonic: string | undefined;
  let nostrPubkey = user.nostrPubkey;
  let encryptedNsec = user.encryptedNsec;

  // Lazy migration: generate keypair for pre-existing users without one
  if (!user.nostrPubkey) {
    const keypair = generateKeypair();
    nostrPubkey = pubkeyHex(keypair.publicKey);
    mnemonic = keypair.mnemonic;

    encryptedNsec = encryptPrivateKey(keypair.privateKey, input.password);
    const encryptedMnemonicValue = encryptMnemonic(keypair.mnemonic, input.password);

    await db.user.update({
      where: { id: user.id },
      data: {
        nostrPubkey,
        encryptedNsec,
        encryptedMnemonic: encryptedMnemonicValue,
        custodyMode: "CUSTODIAL",
      },
    });
  }

  // Cache signing key in Redis for custodial users
  if (encryptedNsec && (user.custodyMode === "CUSTODIAL" || !user.nostrPubkey)) {
    const config = getConfig();
    const privateKey = decryptPrivateKey(encryptedNsec, input.password);
    const cached = encryptForCache(privateKey, config.SIGNING_CACHE_KEY);
    const ttl = getRefreshTtlSeconds();
    await redis.set(`signing_key:${user.id}`, cached, "EX", ttl);
  }

  const accessToken = generateAccessToken({ ...user, nostrPubkey });
  const refreshToken = generateRefreshToken();

  await db.refreshToken.create({
    data: {
      userId: user.id,
      token: refreshToken,
      expiresAt: getRefreshExpiresAt(),
    },
  });

  return {
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, nostrPubkey },
    accessToken,
    refreshToken,
    ...(mnemonic ? { mnemonic } : {}),
  };
}

export async function refresh(token: string) {
  const stored = await db.refreshToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!stored || stored.expiresAt < new Date()) {
    if (stored) {
      await db.refreshToken.deleteMany({ where: { id: stored.id } });
    }
    throw new UnauthorizedError("Invalid or expired refresh token");
  }

  // Rotate: delete old, create new (deleteMany tolerates already-deleted tokens from race conditions)
  await db.refreshToken.deleteMany({ where: { id: stored.id } });

  const accessToken = generateAccessToken(stored.user);
  const newRefreshToken = generateRefreshToken();

  await db.refreshToken.create({
    data: {
      userId: stored.user.id,
      token: newRefreshToken,
      expiresAt: getRefreshExpiresAt(),
    },
  });

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logout(token: string) {
  await db.refreshToken.deleteMany({ where: { token } });
}

export async function recoverMnemonic(userId: string, password: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthorizedError("User not found");
  }

  if (user.custodyMode === "SELF_CUSTODY") {
    throw new ValidationError("Self-custody users manage their own keys");
  }

  if (!user.encryptedMnemonic) {
    throw new ValidationError("No mnemonic available for this account");
  }

  // Verify password before decrypting
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError("Invalid password");
  }

  const mnemonic = decryptMnemonic(user.encryptedMnemonic, password);
  return { mnemonic };
}

const CHALLENGE_TTL = 300; // 5 minutes

export async function generateChallenge() {
  const challenge = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL * 1000).toISOString();
  await redis.set(`challenge:${challenge}`, "1", "EX", CHALLENGE_TTL);
  return { challenge, expiresAt };
}

export async function loginWithPubkey(input: PubkeyLoginInput) {
  // Verify challenge exists and hasn't expired
  const exists = await redis.get(`challenge:${input.challenge}`);
  if (!exists) {
    throw new UnauthorizedError("Invalid or expired challenge");
  }

  // Delete challenge immediately (one-time use)
  await redis.del(`challenge:${input.challenge}`);

  // Verify Schnorr signature over SHA-256(challenge bytes)
  const { sha256 } = await import("@noble/hashes/sha2.js");
  const challengeBytes = new Uint8Array(Buffer.from(input.challenge, "hex"));
  const messageHash = sha256(challengeBytes);
  const pubkeyBytes = new Uint8Array(Buffer.from(input.pubkey, "hex"));
  const signatureBytes = new Uint8Array(Buffer.from(input.signature, "hex"));

  const valid = schnorrVerify(pubkeyBytes, messageHash, signatureBytes);
  if (!valid) {
    throw new UnauthorizedError("Invalid signature");
  }

  // Look up user by pubkey
  const user = await db.user.findUnique({ where: { nostrPubkey: input.pubkey } });
  if (!user) {
    throw new NotFoundError("Account for this pubkey");
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken();

  await db.refreshToken.create({
    data: {
      userId: user.id,
      token: refreshToken,
      expiresAt: getRefreshExpiresAt(),
    },
  });

  return {
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, nostrPubkey: user.nostrPubkey },
    accessToken,
    refreshToken,
  };
}

export async function exportKeys(userId: string, password: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthorizedError("User not found");
  }

  if (user.custodyMode === "SELF_CUSTODY" || !user.encryptedNsec) {
    throw new ValidationError("No keys to export — self-custody users already hold their own keys");
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError("Invalid password");
  }

  const privateKey = decryptPrivateKey(user.encryptedNsec, password);
  const pubkey = new Uint8Array(Buffer.from(user.nostrPubkey!, "hex"));

  return {
    privateKey: Buffer.from(privateKey).toString("hex"),
    nsec: privkeyToNsec(privateKey),
    pubkey: user.nostrPubkey!,
    npub: pubkeyToNpub(pubkey),
  };
}

export async function switchCustody(userId: string, password: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthorizedError("User not found");
  }

  if (user.custodyMode === "SELF_CUSTODY") {
    throw new ValidationError("Already in self-custody mode");
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError("Invalid password");
  }

  // Delete encrypted keys from DB
  await db.user.update({
    where: { id: userId },
    data: {
      encryptedNsec: null,
      encryptedMnemonic: null,
      custodyMode: "SELF_CUSTODY",
    },
  });

  // Delete cached signing key from Redis
  await redis.del(`signing_key:${userId}`);

  return {
    message: "Switched to self-custody mode. This is irreversible — the server no longer holds your private key.",
    warning: "If you have not exported your keys, you will lose access to your cryptographic identity.",
  };
}

export async function changePassword(userId: string, input: ChangePasswordInput) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthorizedError("User not found");
  }

  const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError("Invalid current password");
  }

  const newPasswordHash = await bcrypt.hash(input.newPassword, SALT_ROUNDS);

  // Re-encrypt private key and mnemonic with new password (custodial users only)
  let newEncryptedNsec: string | null = null;
  let newEncryptedMnemonic: string | null = null;

  if (user.encryptedNsec) {
    const privateKey = decryptPrivateKey(user.encryptedNsec, input.currentPassword);
    newEncryptedNsec = encryptPrivateKey(privateKey, input.newPassword);
  }

  if (user.encryptedMnemonic) {
    const mnemonic = decryptMnemonic(user.encryptedMnemonic, input.currentPassword);
    newEncryptedMnemonic = encryptMnemonic(mnemonic, input.newPassword);
  }

  // Update password hash and re-encrypted keys
  await db.user.update({
    where: { id: userId },
    data: {
      passwordHash: newPasswordHash,
      ...(newEncryptedNsec !== null ? { encryptedNsec: newEncryptedNsec } : {}),
      ...(newEncryptedMnemonic !== null ? { encryptedMnemonic: newEncryptedMnemonic } : {}),
    },
  });

  // Invalidate all refresh tokens (force re-login on all devices)
  await db.refreshToken.deleteMany({ where: { userId } });

  // Clear cached signing key from Redis
  await redis.del(`signing_key:${userId}`);

  return { message: "Password changed successfully" };
}

export async function getMe(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      createdAt: true,
      developer: { select: { id: true, studioName: true, stripeOnboarded: true } },
    },
  });
  return user;
}
