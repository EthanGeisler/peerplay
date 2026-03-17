-- DropForeignKey
ALTER TABLE "encryption_keys" DROP CONSTRAINT "encryption_keys_game_id_fkey";

-- AlterTable
ALTER TABLE "games" DROP COLUMN "drm_tier";

-- AlterTable
ALTER TABLE "licenses" DROP COLUMN "decryption_key_enc",
DROP COLUMN "device_fingerprints";

-- AlterTable
ALTER TABLE "torrents" DROP COLUMN "encryption_key_id";

-- DropTable
DROP TABLE "encryption_keys";

-- DropEnum
DROP TYPE "DrmTier";
