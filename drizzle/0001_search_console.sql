CREATE TABLE `google_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text,
	`encrypted_refresh_token` text NOT NULL,
	`scopes` text NOT NULL,
	`connected_at` integer NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `search_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`audit_id` integer,
	`property` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`clicks` real,
	`impressions` real,
	`ctr` real,
	`position` real,
	`previous` text,
	`daily` text,
	`top_queries` text,
	`top_pages` text,
	`inspections` text,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `snapshots_site_idx` ON `search_snapshots` (`site_id`,`fetched_at`);--> statement-breakpoint
ALTER TABLE `search_console_connections` DROP COLUMN `encrypted_refresh_token`;