-- Drop old FTS5 table and create new one with all needed data
DROP TABLE IF EXISTS items_fts;

CREATE VIRTUAL TABLE items_fts USING fts5(
  item_id UNINDEXED,
  name,
  slug UNINDEXED,
  collection_id UNINDEXED,
  collection_slug UNINDEXED,
  field_data UNINDEXED,
  search_text
);
