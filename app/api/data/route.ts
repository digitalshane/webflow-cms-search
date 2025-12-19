import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// Cloudflare's Cache API - available in Workers runtime
declare const caches: CacheStorage & { default: Cache };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=300, s-maxage=3600", // Cache longer since this is static data
};

function jsonResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

interface DataItem {
  id: string;
  name: string;
  slug: string;
  collectionId: string;
  collectionSlug: string;
  fieldData: Record<string, unknown>;
  searchText: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const collectionsParam = searchParams.get("collections") || "all";

  try {
    // Check edge cache first
    const cache = caches.default;
    const cacheKey = new Request(request.url, { method: "GET" });
    const cachedResponse = await cache.match(cacheKey);

    if (cachedResponse) {
      return cachedResponse;
    }

    // Get Cloudflare context ONCE at the start
    const { env } = await getCloudflareContext({ async: true });
    const db = env.DB;

    if (!db) {
      return jsonResponse({ error: "Database not configured" }, 500);
    }

    let items: DataItem[];

    if (collectionsParam.toLowerCase() === "all") {
      // Fetch all items
      const { results: rows } = await db.prepare(`
        SELECT id, name, slug, collection_id, collection_slug, field_data, search_text
        FROM items
      `).all<{
        id: string;
        name: string;
        slug: string;
        collection_id: string;
        collection_slug: string;
        field_data: string;
        search_text: string;
      }>();

      items = rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        collectionId: r.collection_id,
        collectionSlug: r.collection_slug,
        fieldData: JSON.parse(r.field_data),
        searchText: r.search_text,
      }));
    } else {
      // Parse requested collection names
      const requestedNames = collectionsParam
        .split(",")
        .map((s) => s.trim().toLowerCase());

      // Build placeholders for the IN clause
      const placeholders = requestedNames.map(() => "?").join(",");
      // We need 3x the names for slug, displayName, singularName matching
      const params = [...requestedNames, ...requestedNames, ...requestedNames];

      // Single query with subquery for collection filtering
      const { results: rows } = await db.prepare(`
        SELECT id, name, slug, collection_id, collection_slug, field_data, search_text
        FROM items
        WHERE collection_slug IN (
          SELECT slug FROM collections
          WHERE LOWER(slug) IN (${placeholders})
          OR LOWER(display_name) IN (${placeholders})
          OR LOWER(singular_name) IN (${placeholders})
        )
      `).bind(...params).all<{
        id: string;
        name: string;
        slug: string;
        collection_id: string;
        collection_slug: string;
        field_data: string;
        search_text: string;
      }>();

      items = rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        collectionId: r.collection_id,
        collectionSlug: r.collection_slug,
        fieldData: JSON.parse(r.field_data),
        searchText: r.search_text,
      }));
    }

    const response = jsonResponse({ items, total: items.length });

    // Cache the response at the edge for 5 minutes
    await cache.put(cacheKey, response.clone());

    return response;
  } catch (error) {
    console.error("Data fetch error:", error);
    return jsonResponse({ error: "Failed to fetch data", details: String(error) }, 500);
  }
}
