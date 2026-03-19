-- CreateEnum
CREATE TYPE "content_type" AS ENUM ('GAME', 'VIDEO', 'SOFTWARE', 'AUDIO', 'OTHER');

-- AlterTable
ALTER TABLE "games" ADD COLUMN     "content_type" "content_type" NOT NULL DEFAULT 'GAME',
ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}';
