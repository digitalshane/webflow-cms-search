import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

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

interface StoredItem {
  id: string;
  name: string;
  slug: string;
  collectionId: string;
  collectionSlug: string;
  fieldData: Record<string, unknown>;
  searchText: string; // Pre-computed lowercase text for fast searching
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
    const kv = env.SEARCH_CACHE;

    if (!kv) {
      return NextResponse.json({ error: "KV namespace not configured" }, { status: 500 });
    }

    // Fetch all collections
    const collections = await fetchSiteCollections(siteId, token);

    const allItems: StoredItem[] = [];
    const collectionResults: { slug: string; itemCount: number }[] = [];

    // Fetch items from each collection
    for (const collection of collections) {
      const items = await fetchCollectionItems(collection.id, token);

      const storedItems: StoredItem[] = items.map((item) => ({
        id: item.id,
        name: (item.fieldData.name as string) || "",
        slug: (item.fieldData.slug as string) || "",
        collectionId: collection.id,
        collectionSlug: collection.slug,
        fieldData: item.fieldData,
        searchText: buildSearchText(item.fieldData),
      }));

      allItems.push(...storedItems);
      collectionResults.push({ slug: collection.slug, itemCount: items.length });

      // Also store per-collection for filtered searches
      await kv.put(
        `collection:${collection.slug}`,
        JSON.stringify(storedItems),
        { expirationTtl: 86400 * 7 } // 7 days TTL
      );
    }

    // Store all items for "all collections" searches
    await kv.put("all_items", JSON.stringify(allItems), {
      expirationTtl: 86400 * 7, // 7 days TTL
    });

    // Store collection metadata
    await kv.put(
      "collections_meta",
      JSON.stringify(
        collections.map((c) => ({
          id: c.id,
          slug: c.slug,
          displayName: c.displayName,
          singularName: c.singularName,
        }))
      ),
      { expirationTtl: 86400 * 7 }
    );

    // Store sync timestamp
    const syncedAt = new Date().toISOString();
    await kv.put("last_sync", syncedAt);

    const result: SyncResult = {
      success: true,
      collectionsCount: collections.length,
      itemsCount: allItems.length,
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
