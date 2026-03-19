-- AlterTable
ALTER TABLE "games" ADD COLUMN     "creator_public_key" TEXT,
ADD COLUMN     "signature" TEXT;

-- CreateTable
CREATE TABLE "relays" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "last_sync_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "trusted_by_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "relays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "federated_listings" (
    "id" TEXT NOT NULL,
    "relay_url" TEXT NOT NULL,
    "remote_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "creator_pubkey" TEXT,
    "signature" TEXT,
    "content_type" "content_type" NOT NULL DEFAULT 'GAME',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "price_cents" INTEGER NOT NULL DEFAULT 0,
    "cover_image_url" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "federated_listings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "relays_url_key" ON "relays"("url");

-- CreateIndex
CREATE INDEX "federated_listings_slug_idx" ON "federated_listings"("slug");

-- CreateIndex
CREATE INDEX "federated_listings_creator_pubkey_idx" ON "federated_listings"("creator_pubkey");

-- CreateIndex
CREATE UNIQUE INDEX "federated_listings_relay_url_remote_id_key" ON "federated_listings"("relay_url", "remote_id");
