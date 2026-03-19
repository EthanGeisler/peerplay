/**
 * One-time cleanup script: process existing NIP-09 (kind 5) deletion events
 * and remove the stale kind 30078 locker entries they reference.
 *
 * Run on VPS after deploying the storeEvent NIP-09 fix:
 *   cd /opt/boilerdeck && node scripts/cleanup-deleted-locker-events.mjs
 *
 * Or locally with DATABASE_URL set:
 *   DATABASE_URL="postgresql://..." node scripts/cleanup-deleted-locker-events.mjs
 *
 * Safe to run multiple times — idempotent (deleteMany on missing rows is a no-op).
 * Use --dry-run to preview without deleting.
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  if (dryRun) {
    console.log("[dry-run] No changes will be made.\n");
  }

  // 1. Fetch all kind 5 deletion events
  const deletionEvents = await db.event.findMany({
    where: { kind: 5 },
  });

  console.log(`Found ${deletionEvents.length} kind 5 deletion event(s).\n`);

  if (deletionEvents.length === 0) {
    console.log("Nothing to clean up.");
    return;
  }

  let totalDeleted = 0;

  for (const delEvent of deletionEvents) {
    const tags = delEvent.tags;
    if (!Array.isArray(tags)) continue;

    const eventIdsToDelete = [];

    for (const tag of tags) {
      if (!Array.isArray(tag)) continue;

      // "e" tags — direct event ID references
      if (tag[0] === "e" && tag[1]) {
        eventIdsToDelete.push(tag[1]);
      }

      // "a" tags — addressable event references (kind:pubkey:d-tag)
      if (tag[0] === "a" && tag[1]) {
        const parts = tag[1].split(":");
        if (parts.length >= 3) {
          const kind = parseInt(parts[0], 10);
          const pubkey = parts[1];
          const dTagValue = parts.slice(2).join(":");
          if (!isNaN(kind) && pubkey === delEvent.pubkey) {
            const found = await db.event.findUnique({
              where: { pubkey_kind_dTag: { pubkey, kind, dTag: dTagValue } },
              select: { id: true },
            });
            if (found) {
              eventIdsToDelete.push(found.id);
            }
          }
        }
      }
    }

    if (eventIdsToDelete.length === 0) continue;

    // Check which of these events actually exist and belong to the same author
    const existing = await db.event.findMany({
      where: {
        id: { in: eventIdsToDelete },
        pubkey: delEvent.pubkey,
        kind: { not: 5 }, // Don't delete other deletion events
      },
      select: { id: true, kind: true, dTag: true },
    });

    if (existing.length === 0) continue;

    console.log(
      `Deletion event ${delEvent.id.slice(0, 12)}... (by ${delEvent.pubkey.slice(0, 8)}...) → ` +
      `${existing.length} event(s) to remove:`
    );
    for (const e of existing) {
      console.log(`  - ${e.id.slice(0, 12)}... (kind ${e.kind}, d-tag: ${e.dTag || "none"})`);
    }

    if (!dryRun) {
      // Unlink any listings referencing these events
      await db.listing.updateMany({
        where: { eventId: { in: existing.map((e) => e.id) } },
        data: { eventId: null },
      });

      const result = await db.event.deleteMany({
        where: {
          id: { in: existing.map((e) => e.id) },
          pubkey: delEvent.pubkey,
        },
      });
      totalDeleted += result.count;
      console.log(`  Deleted ${result.count} event(s).`);
    } else {
      totalDeleted += existing.length;
      console.log(`  [dry-run] Would delete ${existing.length} event(s).`);
    }
  }

  console.log(`\n${dryRun ? "[dry-run] Would have deleted" : "Deleted"} ${totalDeleted} stale event(s) total.`);
}

main()
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
