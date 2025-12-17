import { NextRequest, NextResponse } from "next/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
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

interface SearchResult {
  id: string;
  name: string;
  slug: string;
  collectionId: string;
  fieldData: Record<string, unknown>;
}

const WEBFLOW_API_BASE = "https://api-cdn.webflow.com/v2";

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
      headers: {
        Authorization: `Bearer ${token}`,
      },
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

function searchItems(
  items: WebflowItem[],
  query: string,
  collectionId: string
): SearchResult[] {
  const lowerQuery = query.toLowerCase();

  return items
    .filter((item) => {
      const fieldData = item.fieldData;
      return Object.values(fieldData).some((value) => {
        if (typeof value === "string") {
          return value.toLowerCase().includes(lowerQuery);
        }
        return false;
      });
    })
    .map((item) => ({
      id: item.id,
      name: (item.fieldData.name as string) || "",
      slug: (item.fieldData.slug as string) || "",
      collectionId,
      fieldData: item.fieldData,
    }));
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");
  const collections = searchParams.get("collections");

  if (!query) {
    return jsonResponse({ error: "Query parameter 'q' is required" }, 400);
  }

  if (!collections) {
    return jsonResponse(
      { error: "Query parameter 'collections' is required" },
      400
    );
  }

  const token = process.env.WEBFLOW_API_TOKEN;
  if (!token) {
    return jsonResponse(
      { error: "Webflow API token not configured" },
      500
    );
  }

  const collectionIds = collections.split(",").map((id) => id.trim());
  const results: SearchResult[] = [];

  try {
    for (const collectionId of collectionIds) {
      const items = await fetchCollectionItems(collectionId, token);
      const matches = searchItems(items, query, collectionId);
      results.push(...matches);
    }

    return jsonResponse({
      results,
      total: results.length,
    });
  } catch (error) {
    console.error("Search error:", error);
    return jsonResponse(
      { error: "Failed to search collections" },
      500
    );
  }
}
