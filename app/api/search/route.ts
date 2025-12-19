import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=60, s-maxage=300",
};

function jsonResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

interface SearchResult {
  id: string;
  name: string;
  slug: string;
  collectionId: string;
  fieldData: Record<string, unknown>;
}

// Escape special FTS5 characters and format for search
function formatFtsQuery(query: string): string {
  const escaped = query.replace(/"/g, '""');
  const words = escaped.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '""';
  return words.map((w) => `"${w}"*`).join(" ");
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");
  const collectionsParam = searchParams.get("collections") || "all";

  if (!query) {
    return jsonResponse({ error: "Query parameter 'q' is required" }, 400);
  }

  try {
    // Get Cloudflare context ONCE at the start - no async getDb() call
    const { env } = await getCloudflareContext({ async: true });
    const db = env.DB;

    if (!db) {
      return jsonResponse({ error: "Database not configured" }, 500);
    }

    const ftsQuery = formatFtsQuery(query);
    let results: SearchResult[];

    if (collectionsParam.toLowerCase() === "all") {
      // Single query directly from FTS5
      const { results: rows } = await db.prepare(`
        SELECT item_id, name, slug, collection_id, field_data
        FROM items_fts
        WHERE items_fts MATCH ?
        LIMIT 100
      `).bind(ftsQuery).all<{
        item_id: string;
        name: string;
        slug: string;
        collection_id: string;
        field_data: string;
      }>();

      results = rows.map((r) => ({
        id: r.item_id,
        name: r.name,
        slug: r.slug,
        collectionId: r.collection_id,
        fieldData: JSON.parse(r.field_data),
      }));
    } else {
      // Parse requested collection names
      const requestedNames = collectionsParam
        .split(",")
        .map((s) => s.trim().toLowerCase());

      // Build placeholders for the IN clause
      const placeholders = requestedNames.map(() => "?").join(",");
      // We need 3x the names for slug, displayName, singularName matching
      const params = [...requestedNames, ...requestedNames, ...requestedNames, ftsQuery];

      // Single query with subquery for collection filtering - no separate collections fetch
      // Note: FTS5 requires table name (not alias) in MATCH clause
      const { results: rows } = await db.prepare(`
        SELECT item_id, name, slug, collection_id, field_data
        FROM items_fts
        WHERE collection_slug IN (
          SELECT slug FROM collections
          WHERE LOWER(slug) IN (${placeholders})
          OR LOWER(display_name) IN (${placeholders})
          OR LOWER(singular_name) IN (${placeholders})
        )
        AND items_fts MATCH ?
        LIMIT 100
      `).bind(...params).all<{
        item_id: string;
        name: string;
        slug: string;
        collection_id: string;
        field_data: string;
      }>();

      results = rows.map((r) => ({
        id: r.item_id,
        name: r.name,
        slug: r.slug,
        collectionId: r.collection_id,
        fieldData: JSON.parse(r.field_data),
      }));
    }

    return jsonResponse({ results, total: results.length });
  } catch (error) {
    console.error("Search error:", error);
    return jsonResponse({ error: "Failed to search", details: String(error) }, 500);
  }
}
