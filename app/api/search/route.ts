import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=60, s-maxage=300", // Cache for 5 min at edge
};

function jsonResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

interface StoredItem {
  id: string;
  name: string;
  slug: string;
  collectionId: string;
  collectionSlug: string;
  fieldData: Record<string, unknown>;
  searchText: string;
}

interface SearchResult {
  id: string;
  name: string;
  slug: string;
  collectionId: string;
  fieldData: Record<string, unknown>;
}

interface CollectionMeta {
  id: string;
  slug: string;
  displayName: string;
  singularName: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");
  const collectionsParam = searchParams.get("collections") || "all";

  if (!query) {
    return jsonResponse({ error: "Query parameter 'q' is required" }, 400);
  }

  try {
    const { env } = await getCloudflareContext({ async: true });
    const kv = env.SEARCH_CACHE;

    if (!kv) {
      return jsonResponse({ error: "KV namespace not configured" }, 500);
    }

    const lowerQuery = query.toLowerCase();
    let items: StoredItem[] = [];

    if (collectionsParam.toLowerCase() === "all") {
      // Fetch all items
      const allItemsJson = await kv.get("all_items");
      if (allItemsJson) {
        items = JSON.parse(allItemsJson);
      }
    } else {
      // Fetch from specific collections
      const collectionsMeta: CollectionMeta[] = JSON.parse(
        (await kv.get("collections_meta")) || "[]"
      );

      const requestedSlugs = collectionsParam
        .split(",")
        .map((s) => s.trim().toLowerCase());

      // Resolve collection names to slugs
      const matchingSlugs = requestedSlugs
        .map((name) => {
          const found = collectionsMeta.find(
            (c) =>
              c.slug.toLowerCase() === name ||
              c.displayName.toLowerCase() === name ||
              c.singularName.toLowerCase() === name
          );
          return found?.slug;
        })
        .filter((slug): slug is string => Boolean(slug));

      // Fetch items from each matching collection
      for (const slug of matchingSlugs) {
        const collectionJson = await kv.get(`collection:${slug}`);
        if (collectionJson) {
          const collectionItems: StoredItem[] = JSON.parse(collectionJson);
          items.push(...collectionItems);
        }
      }
    }

    // Search using pre-computed searchText
    const results: SearchResult[] = items
      .filter((item) => item.searchText.includes(lowerQuery))
      .map((item) => ({
        id: item.id,
        name: item.name,
        slug: item.slug,
        collectionId: item.collectionId,
        fieldData: item.fieldData,
      }));

    return jsonResponse({ results, total: results.length });
  } catch (error) {
    console.error("Search error:", error);
    return jsonResponse({ error: "Failed to search", details: String(error) }, 500);
  }
}
