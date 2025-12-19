import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db/getDb";
import { collectionsTable } from "@/src/db/schema";
import { sql } from "drizzle-orm";

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
    const db = await getDb();
    const ftsQuery = formatFtsQuery(query);

    let results: SearchResult[];

    if (collectionsParam.toLowerCase() === "all") {
      // Single query directly from FTS5 - no JOIN needed
      const rows = await db.all<{
        item_id: string;
        name: string;
        slug: string;
        collection_id: string;
        field_data: string;
      }>(sql`
        SELECT item_id, name, slug, collection_id, field_data
        FROM items_fts
        WHERE items_fts MATCH ${ftsQuery}
        LIMIT 100
      `);

      results = rows.map((r) => ({
        id: r.item_id,
        name: r.name,
        slug: r.slug,
        collectionId: r.collection_id,
        fieldData: JSON.parse(r.field_data),
      }));
    } else {
      // Get collection slugs to filter by
      const requestedNames = collectionsParam
        .split(",")
        .map((s) => s.trim().toLowerCase());

      // Find matching collection slugs
      const collections = await db.select().from(collectionsTable);
      const matchingSlugs = collections
        .filter(
          (c) =>
            requestedNames.includes(c.slug.toLowerCase()) ||
            requestedNames.includes(c.displayName.toLowerCase()) ||
            requestedNames.includes(c.singularName.toLowerCase())
        )
        .map((c) => c.slug);

      if (matchingSlugs.length === 0) {
        return jsonResponse({ results: [], total: 0 });
      }

      // Single query with collection filter - no JOIN needed
      const slugList = matchingSlugs.map((s) => `'${s.replace(/'/g, "''")}'`).join(",");
      const rows = await db.all<{
        item_id: string;
        name: string;
        slug: string;
        collection_id: string;
        field_data: string;
      }>(sql.raw(`
        SELECT item_id, name, slug, collection_id, field_data
        FROM items_fts
        WHERE items_fts MATCH '${ftsQuery.replace(/'/g, "''")}'
        AND collection_slug IN (${slugList})
        LIMIT 100
      `));

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
