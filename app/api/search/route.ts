import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db/getDb";
import { collectionsTable, itemsTable } from "@/src/db/schema";
import { sql, inArray } from "drizzle-orm";

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

interface SearchResult {
  id: string;
  name: string;
  slug: string;
  collectionId: string;
  fieldData: Record<string, unknown>;
}

// Escape special FTS5 characters and format for search
function formatFtsQuery(query: string): string {
  // Escape double quotes and wrap each word with * for prefix matching
  const escaped = query.replace(/"/g, '""');
  // Split into words and add * for prefix matching on each word
  const words = escaped.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '""';
  // Use * suffix for prefix matching on each word
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

    let matchingIds: string[];

    if (collectionsParam.toLowerCase() === "all") {
      // Search all items using FTS5
      const ftsResults = await db.all<{ item_id: string }>(sql`
        SELECT item_id FROM items_fts WHERE items_fts MATCH ${ftsQuery}
      `);
      matchingIds = ftsResults.map((r) => r.item_id);
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

      // Search within specific collections using FTS5 with collection filter
      // Build the collection filter for SQL
      const slugList = matchingSlugs.map((s) => `'${s.replace(/'/g, "''")}'`).join(",");
      const ftsResults = await db.all<{ item_id: string }>(sql.raw(`
        SELECT item_id FROM items_fts
        WHERE items_fts MATCH '${ftsQuery.replace(/'/g, "''")}'
        AND collection_slug IN (${slugList})
      `));
      matchingIds = ftsResults.map((r) => r.item_id);
    }

    if (matchingIds.length === 0) {
      return jsonResponse({ results: [], total: 0 });
    }

    // Fetch full item data for matching IDs
    const results: SearchResult[] = await db
      .select({
        id: itemsTable.id,
        name: itemsTable.name,
        slug: itemsTable.slug,
        collectionId: itemsTable.collectionId,
        fieldData: itemsTable.fieldData,
      })
      .from(itemsTable)
      .where(inArray(itemsTable.id, matchingIds));

    return jsonResponse({ results, total: results.length });
  } catch (error) {
    console.error("Search error:", error);
    return jsonResponse({ error: "Failed to search", details: String(error) }, 500);
  }
}
