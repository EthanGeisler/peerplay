-- CreateIndex
CREATE INDEX "events_kind_created_at_unix_idx" ON "events"("kind", "created_at_unix");
