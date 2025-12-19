import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db/getDb";
import { collectionsTable, itemsTable } from "@/src/db/schema";
import { like, eq, inArray, and } from "drizzle-orm";

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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");
  const collectionsParam = searchParams.get("collections") || "all";

  if (!query) {
    return jsonResponse({ error: "Query parameter 'q' is required" }, 400);
  }

  try {
    const db = await getDb();
    const lowerQuery = `%${query.toLowerCase()}%`;

    let results: SearchResult[];

    if (collectionsParam.toLowerCase() === "all") {
      // Search all items using SQL LIKE
      const items = await db
        .select({
          id: itemsTable.id,
          name: itemsTable.name,
          slug: itemsTable.slug,
          collectionId: itemsTable.collectionId,
          fieldData: itemsTable.fieldData,
        })
        .from(itemsTable)
        .where(like(itemsTable.searchText, lowerQuery));

      results = items;
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

      // Search within specific collections using combined SQL conditions
      const collectionFilter =
        matchingSlugs.length === 1
          ? eq(itemsTable.collectionSlug, matchingSlugs[0])
          : inArray(itemsTable.collectionSlug, matchingSlugs);

      const items = await db
        .select({
          id: itemsTable.id,
          name: itemsTable.name,
          slug: itemsTable.slug,
          collectionId: itemsTable.collectionId,
          fieldData: itemsTable.fieldData,
        })
        .from(itemsTable)
        .where(and(collectionFilter, like(itemsTable.searchText, lowerQuery)));

      results = items;
    }

    return jsonResponse({ results, total: results.length });
  } catch (error) {
    console.error("Search error:", error);
    return jsonResponse({ error: "Failed to search", details: String(error) }, 500);
  }
}
