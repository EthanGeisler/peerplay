-- CreateEnum
CREATE TYPE "custody_mode" AS ENUM ('CUSTODIAL', 'SELF_CUSTODY');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "custody_mode" "custody_mode" NOT NULL DEFAULT 'CUSTODIAL',
ADD COLUMN     "encrypted_mnemonic" TEXT,
ADD COLUMN     "encrypted_nsec" TEXT,
ADD COLUMN     "nostr_pubkey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_nostr_pubkey_key" ON "users"("nostr_pubkey");
