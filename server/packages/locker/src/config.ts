/**
 * Locker-specific configuration.
 *
 * Reads from environment variables with sensible defaults.
 * Separate from shared/config.ts to avoid adding locker-specific
 * env vars to the global config (which would require them everywhere).
 */

export interface LockerConfig {
  /** Directory for locker file storage. Default: ./data/locker/ */
  LOCKER_DIR: string;
  /** Max file size in bytes. Default: 5 GB */
  LOCKER_MAX_FILE_SIZE: number;
  /** Per-user quota in GB. Default: 50 */
  LOCKER_QUOTA_GB: number;
}

const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB
const DEFAULT_QUOTA_GB = 50;

let _config: LockerConfig | null = null;

export function getLockerConfig(): LockerConfig {
  if (!_config) {
    _config = {
      LOCKER_DIR: process.env.LOCKER_DIR || "./data/locker",
      LOCKER_MAX_FILE_SIZE: process.env.LOCKER_MAX_FILE_SIZE
        ? parseInt(process.env.LOCKER_MAX_FILE_SIZE, 10)
        : DEFAULT_MAX_FILE_SIZE,
      LOCKER_QUOTA_GB: process.env.LOCKER_QUOTA_GB
        ? parseInt(process.env.LOCKER_QUOTA_GB, 10)
        : DEFAULT_QUOTA_GB,
    };
  }
  return _config;
}
