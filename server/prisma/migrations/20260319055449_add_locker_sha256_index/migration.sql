-- AlterTable
ALTER TABLE "locker_files" ADD COLUMN     "sha256" TEXT;

-- CreateIndex
CREATE INDEX "locker_files_sha256_idx" ON "locker_files"("sha256");
