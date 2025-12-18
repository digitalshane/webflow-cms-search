#!/usr/bin/env npx ts-node

/**
 * Manual sync script to populate KV cache from Webflow
 *
 * Usage:
 *   npx ts-node scripts/sync.ts
 *
 * Or add to package.json scripts:
 *   "sync": "ts-node scripts/sync.ts"
 *
 * For production, call the /api/sync endpoint directly:
 *   curl -X GET https://your-domain.com/api/sync -H "Authorization: Bearer YOUR_SYNC_SECRET"
 */

const SYNC_URL = process.env.SYNC_URL || "http://localhost:3000/api/sync";
const SYNC_SECRET = process.env.SYNC_SECRET;

async function main() {
  console.log("Starting sync...");
  console.log(`Calling: ${SYNC_URL}`);

  const headers: Record<string, string> = {};
  if (SYNC_SECRET) {
    headers["Authorization"] = `Bearer ${SYNC_SECRET}`;
  }

  try {
    const response = await fetch(SYNC_URL, { headers });
    const data = (await response.json()) as {
      collectionsCount: number;
      itemsCount: number;
      collections: { slug: string; itemCount: number }[];
      syncedAt: string;
      error?: string;
    };

    if (!response.ok) {
      console.error("Sync failed:", data);
      process.exit(1);
    }

    console.log("Sync completed successfully!");
    console.log(`Collections: ${data.collectionsCount}`);
    console.log(`Total items: ${data.itemsCount}`);
    console.log("Collections synced:");
    data.collections.forEach((c) => {
      console.log(`  - ${c.slug}: ${c.itemCount} items`);
    });
    console.log(`Synced at: ${data.syncedAt}`);
  } catch (error) {
    console.error("Sync error:", error);
    process.exit(1);
  }
}

main();
