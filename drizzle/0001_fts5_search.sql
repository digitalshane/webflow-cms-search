-- Create FTS5 virtual table for fast full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  item_id,
  name,
  search_text,
  collection_slug
);
