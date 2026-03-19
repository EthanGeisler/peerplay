-- CreateTable
CREATE TABLE "locker_files" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "info_hash" TEXT NOT NULL,
    "torrent_path" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "locker_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locker_quotas" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "used_bytes" BIGINT NOT NULL DEFAULT 0,
    "max_bytes" BIGINT NOT NULL,

    CONSTRAINT "locker_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "locker_files_entry_id_key" ON "locker_files"("entry_id");

-- CreateIndex
CREATE INDEX "locker_files_user_id_idx" ON "locker_files"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "locker_quotas_user_id_key" ON "locker_quotas"("user_id");

-- AddForeignKey
ALTER TABLE "locker_files" ADD CONSTRAINT "locker_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locker_quotas" ADD CONSTRAINT "locker_quotas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
