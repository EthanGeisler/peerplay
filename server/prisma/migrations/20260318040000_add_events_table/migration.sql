-- AlterTable
ALTER TABLE "games" ADD COLUMN     "event_id" TEXT;

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "created_at_unix" INTEGER NOT NULL,
    "kind" INTEGER NOT NULL,
    "tags" JSONB NOT NULL,
    "content" TEXT NOT NULL,
    "sig" TEXT NOT NULL,
    "d_tag" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "events_kind_idx" ON "events"("kind");

-- CreateIndex
CREATE INDEX "events_pubkey_idx" ON "events"("pubkey");

-- CreateIndex
CREATE INDEX "events_created_at_unix_idx" ON "events"("created_at_unix");

-- CreateIndex
CREATE UNIQUE INDEX "events_pubkey_kind_d_tag_key" ON "events"("pubkey", "kind", "d_tag");

-- CreateIndex
CREATE UNIQUE INDEX "games_event_id_key" ON "games"("event_id");

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
