import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db/getDb";
import { collectionsTable, itemsTable } from "@/src/db/schema";
import { eq, inArray } from "drizzle-orm";

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
    const db = await getDb();

    let items: DataItem[];

    if (collectionsParam.toLowerCase() === "all") {
      // Fetch all items
      items = await db.select().from(itemsTable);
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
        return jsonResponse({ items: [], total: 0 });
      }

      // Fetch items from specific collections
      const collectionFilter =
        matchingSlugs.length === 1
          ? eq(itemsTable.collectionSlug, matchingSlugs[0])
          : inArray(itemsTable.collectionSlug, matchingSlugs);

      items = await db.select().from(itemsTable).where(collectionFilter);
    }

    return jsonResponse({ items, total: items.length });
  } catch (error) {
    console.error("Data fetch error:", error);
    return jsonResponse({ error: "Failed to fetch data", details: String(error) }, 500);
  }
}
