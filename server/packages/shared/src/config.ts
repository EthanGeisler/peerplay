import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PLATFORM_FEE_PERCENT: z.coerce.number().default(1),
  STRIPE_CONNECT_RETURN_URL: z.string().optional(),
  STRIPE_CONNECT_REFRESH_URL: z.string().optional(),
  B2_ENDPOINT: z.string().optional(),
  B2_REGION: z.string().optional(),
  B2_BUCKET: z.string().optional(),
  B2_KEY_ID: z.string().optional(),
  B2_APP_KEY: z.string().optional(),
  TRACKER_URL: z.string().default("http://localhost:6969/announce"),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  CORS_ADDITIONAL_ORIGINS: z.string().default(""),
  DRM_MASTER_KEK: z
    .string()
    .regex(/^[0-9a-fA-F]{64,}$/, "Must be at least 64 hex characters")
    .optional(),
  GAMES_DIR: z.string().default("/opt/boilerdeck/games"),
  TRANSMISSION_RPC_URL: z.string().default("http://127.0.0.1:9091/transmission/rpc"),
});

export type Env = z.infer<typeof envSchema>;

let _config: Env | null = null;

export function getConfig(): Env {
  if (!_config) {
    _config = envSchema.parse(process.env);
  }
  return _config;
}
