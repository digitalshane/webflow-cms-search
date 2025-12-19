import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// D1 batch limit is ~500 statements, use conservative chunk size
const BATCH_CHUNK_SIZE = 400;

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
    const { env } = await getCloudflareContext({ async: true });
    const d1 = env.DB;

    if (!d1) {
      return NextResponse.json({ error: "D1 database not configured" }, { status: 500 });
    }

    // Fetch all collections from Webflow
    const collections = await fetchSiteCollections(siteId, token);

    const collectionResults: { slug: string; itemCount: number }[] = [];
    let totalItems = 0;

    // Collect all items from all collections first
    const allItems: { collection: WebflowCollection; item: WebflowItem }[] = [];

    for (const collection of collections) {
      const items = await fetchCollectionItems(collection.id, token);
      for (const item of items) {
        allItems.push({ collection, item });
      }
      collectionResults.push({ slug: collection.slug, itemCount: items.length });
      totalItems += items.length;
    }

    // Build all SQL statements for batch execution
    const statements: D1PreparedStatement[] = [];

    // Clear existing data
    statements.push(d1.prepare("DELETE FROM items"));
    statements.push(d1.prepare("DELETE FROM collections"));
    statements.push(d1.prepare("DELETE FROM items_fts"));

    // Insert collections
    for (const collection of collections) {
      statements.push(
        d1.prepare(
          "INSERT INTO collections (id, slug, display_name, singular_name) VALUES (?, ?, ?, ?)"
        ).bind(collection.id, collection.slug, collection.displayName, collection.singularName)
      );
    }

    // Insert items and FTS entries
    for (const { collection, item } of allItems) {
      const name = (item.fieldData.name as string) || "";
      const slug = (item.fieldData.slug as string) || "";
      const searchText = buildSearchText(item.fieldData);
      const fieldDataJson = JSON.stringify(item.fieldData);

      statements.push(
        d1.prepare(
          "INSERT INTO items (id, name, slug, collection_id, collection_slug, field_data, search_text) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(item.id, name, slug, collection.id, collection.slug, fieldDataJson, searchText)
      );

      statements.push(
        d1.prepare(
          "INSERT INTO items_fts (item_id, name, slug, collection_id, collection_slug, field_data, search_text) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(item.id, name, slug, collection.id, collection.slug, fieldDataJson, searchText)
      );
    }

    // Store sync timestamp
    const syncedAt = new Date().toISOString();
    statements.push(
      d1.prepare(
        "INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).bind("last_sync", syncedAt)
    );

    // Execute statements in chunks (D1 has a ~500 statement limit per batch)
    for (let i = 0; i < statements.length; i += BATCH_CHUNK_SIZE) {
      const chunk = statements.slice(i, i + BATCH_CHUNK_SIZE);
      await d1.batch(chunk);
    }

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
