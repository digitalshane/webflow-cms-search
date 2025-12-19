import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db/getDb";
import { collectionsTable, itemsTable, syncMetaTable } from "@/src/db/schema";

const WEBFLOW_API_BASE = "https://api-cdn.webflow.com/v2";

interface WebflowCollection {
  id: string;
  displayName: string;
  singularName: string;
  slug: string;
}

interface CollectionsResponse {
  collections: WebflowCollection[];
}

interface WebflowItem {
  id: string;
  lastPublished: string;
  lastUpdated: string;
  createdOn: string;
  fieldData: Record<string, unknown>;
  cmsLocaleId: string;
  isArchived: boolean;
  isDraft: boolean;
}

interface WebflowResponse {
  items: WebflowItem[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

interface SyncResult {
  success: boolean;
  collectionsCount: number;
  itemsCount: number;
  collections: { slug: string; itemCount: number }[];
  syncedAt: string;
}

async function fetchSiteCollections(
  siteId: string,
  token: string
): Promise<WebflowCollection[]> {
  const url = `${WEBFLOW_API_BASE}/sites/${siteId}/collections`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch collections: ${response.status}`);
  }

  const data: CollectionsResponse = await response.json();
  return data.collections || [];
}

async function fetchCollectionItems(
  collectionId: string,
  token: string
): Promise<WebflowItem[]> {
  const allItems: WebflowItem[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `${WEBFLOW_API_BASE}/collections/${collectionId}/items/live?offset=${offset}&limit=${limit}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Webflow API error: ${response.status}`);
    }

    const data: WebflowResponse = await response.json();
    allItems.push(...data.items);

    if (data.items.length < limit || allItems.length >= data.pagination.total) {
      break;
    }

    offset += limit;
  }

  return allItems;
}

function buildSearchText(fieldData: Record<string, unknown>): string {
  return Object.values(fieldData)
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

export async function GET(request: NextRequest) {
  // Check for secret to prevent unauthorized syncs
  const authHeader = request.headers.get("authorization");
  const syncSecret = process.env.SYNC_SECRET;

  if (syncSecret && authHeader !== `Bearer ${syncSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.WEBFLOW_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Webflow API token not configured" }, { status: 500 });
  }

  const siteId = process.env.WEBFLOW_SITE_ID;
  if (!siteId) {
    return NextResponse.json({ error: "Webflow site ID not configured" }, { status: 500 });
  }

  try {
    const db = await getDb();

    // Fetch all collections from Webflow
    const collections = await fetchSiteCollections(siteId, token);

    const collectionResults: { slug: string; itemCount: number }[] = [];
    let totalItems = 0;

    // Clear existing data and insert fresh data
    await db.delete(itemsTable);
    await db.delete(collectionsTable);

    // Insert collections metadata
    for (const collection of collections) {
      await db.insert(collectionsTable).values({
        id: collection.id,
        slug: collection.slug,
        displayName: collection.displayName,
        singularName: collection.singularName,
      });

      // Fetch and insert items for this collection
      const items = await fetchCollectionItems(collection.id, token);

      for (const item of items) {
        await db.insert(itemsTable).values({
          id: item.id,
          name: (item.fieldData.name as string) || "",
          slug: (item.fieldData.slug as string) || "",
          collectionId: collection.id,
          collectionSlug: collection.slug,
          fieldData: item.fieldData,
          searchText: buildSearchText(item.fieldData),
        });
      }

      collectionResults.push({ slug: collection.slug, itemCount: items.length });
      totalItems += items.length;
    }

    // Store sync timestamp
    const syncedAt = new Date().toISOString();
    await db
      .insert(syncMetaTable)
      .values({ key: "last_sync", value: syncedAt })
      .onConflictDoUpdate({
        target: syncMetaTable.key,
        set: { value: syncedAt },
      });

    const result: SyncResult = {
      success: true,
      collectionsCount: collections.length,
      itemsCount: totalItems,
      collections: collectionResults,
      syncedAt,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: "Failed to sync", details: String(error) },
      { status: 500 }
    );
  }
}

// POST also triggers sync (for webhooks)
export async function POST(request: NextRequest) {
  return GET(request);
}
