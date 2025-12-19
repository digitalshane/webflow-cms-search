CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`display_name` text NOT NULL,
	`singular_name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_slug_unique` ON `collections` (`slug`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`collection_id` text NOT NULL,
	`collection_slug` text NOT NULL,
	`field_data` text NOT NULL,
	`search_text` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `items_collection_slug_idx` ON `items` (`collection_slug`);--> statement-breakpoint
CREATE INDEX `items_search_text_idx` ON `items` (`search_text`);--> statement-breakpoint
CREATE TABLE `sync_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
