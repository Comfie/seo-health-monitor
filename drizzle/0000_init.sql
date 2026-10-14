CREATE TABLE `audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`input_url` text NOT NULL,
	`start_url` text NOT NULL,
	`status` text NOT NULL,
	`stage` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`log` text DEFAULT '[]' NOT NULL,
	`error` text,
	`overall_score` real,
	`category_scores` text,
	`counts` text,
	`pages_scanned` integer,
	`meta` text,
	`ai_report` text,
	`ai_model` text,
	`ai_generated_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audits_site_idx` ON `audits` (`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`audit_id` integer NOT NULL,
	`check_id` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`score` real,
	`weight` real NOT NULL,
	`summary` text NOT NULL,
	`unavailable_reason` text,
	`affected_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `checks_audit_idx` ON `checks` (`audit_id`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`audit_id` integer NOT NULL,
	`issue_key` text NOT NULL,
	`check_id` text NOT NULL,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`evidence` text NOT NULL,
	`why` text NOT NULL,
	`fix` text NOT NULL,
	`implementation` text NOT NULL,
	`benefit` text NOT NULL,
	`impact` integer NOT NULL,
	`confidence` text NOT NULL,
	`effort` text NOT NULL,
	`priority_score` real NOT NULL,
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issues_audit_idx` ON `issues` (`audit_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `issues_audit_key_idx` ON `issues` (`audit_id`,`issue_key`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`audit_id` integer NOT NULL,
	`url` text NOT NULL,
	`final_url` text NOT NULL,
	`status` integer,
	`depth` integer NOT NULL,
	`source` text NOT NULL,
	`title` text,
	`meta_description` text,
	`h1` text,
	`canonical` text,
	`meta_robots` text,
	`word_count` integer,
	`response_time_ms` integer,
	`data` text NOT NULL,
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pages_audit_idx` ON `pages` (`audit_id`);--> statement-breakpoint
CREATE TABLE `performance_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`audit_id` integer NOT NULL,
	`url` text NOT NULL,
	`strategy` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`performance_score` real,
	`lcp_ms` real,
	`cls` real,
	`tbt_ms` real,
	`fcp_ms` real,
	`speed_index_ms` real,
	`ttfb_ms` real,
	`field_lcp_ms` real,
	`field_inp_ms` real,
	`field_cls` real,
	`field_category` text,
	`field_source` text,
	`opportunities` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `perf_audit_idx` ON `performance_results` (`audit_id`);--> statement-breakpoint
CREATE TABLE `search_console_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`property` text NOT NULL,
	`status` text NOT NULL,
	`scopes` text NOT NULL,
	`encrypted_refresh_token` text,
	`connected_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host` text NOT NULL,
	`display_url` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sites_host_unique` ON `sites` (`host`);