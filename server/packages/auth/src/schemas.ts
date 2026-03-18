import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().min(2, "Display name must be at least 2 characters").max(50),
  pubkey: z.string().length(64).regex(/^[0-9a-f]+$/).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const recoverMnemonicSchema = z.object({
  password: z.string(),
});

export const pubkeyLoginSchema = z.object({
  pubkey: z.string().length(64).regex(/^[0-9a-f]+$/),
  challenge: z.string().length(64).regex(/^[0-9a-f]+$/),
  signature: z.string().length(128).regex(/^[0-9a-f]+$/),
});

export const exportKeysSchema = z.object({
  password: z.string(),
});

export const switchCustodySchema = z.object({
  mode: z.literal("SELF_CUSTODY"),
  password: z.string(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RecoverMnemonicInput = z.infer<typeof recoverMnemonicSchema>;
export type PubkeyLoginInput = z.infer<typeof pubkeyLoginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
