import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";

// Collections metadata table
export const collectionsTable = sqliteTable("collections", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  singularName: text("singular_name").notNull(),
});

// CMS items table with index on collection_slug for faster filtering
export const itemsTable = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    collectionId: text("collection_id").notNull(),
    collectionSlug: text("collection_slug").notNull(),
    fieldData: text("field_data", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    searchText: text("search_text").notNull(), // Pre-computed lowercase text for fast searching
  },
  (table) => [
    index("items_collection_slug_idx").on(table.collectionSlug),
    index("items_search_text_idx").on(table.searchText),
  ]
);

// Sync metadata table
export const syncMetaTable = sqliteTable("sync_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
