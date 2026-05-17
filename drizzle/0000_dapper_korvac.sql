CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text NOT NULL,
	`image` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `deferred_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`better_auth_user_id` text NOT NULL,
	`tuple_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`relation` text NOT NULL,
	`source_subject_type` text NOT NULL,
	`has_condition` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`processed_at` integer,
	`type` text DEFAULT 'grant' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deferred_grants_tuple_id_unique` ON `deferred_grants` (`tuple_id`);--> statement-breakpoint
CREATE TABLE `grant_mirror` (
	`id` text PRIMARY KEY NOT NULL,
	`auther_tuple_id` text NOT NULL,
	`payload_user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`relation` text NOT NULL,
	`source_subject_type` text NOT NULL,
	`requires_live_check` integer DEFAULT false NOT NULL,
	`sync_status` text DEFAULT 'active' NOT NULL,
	`synced_at` integer NOT NULL,
	FOREIGN KEY (`payload_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grant_mirror_auther_tuple_id_unique` ON `grant_mirror` (`auther_tuple_id`);--> statement-breakpoint
CREATE INDEX `grant_mirror_payload_user_entity_status_idx` ON `grant_mirror` (`payload_user_id`,`entity_type`,`sync_status`);--> statement-breakpoint
CREATE INDEX `grant_mirror_source_subject_payload_user_idx` ON `grant_mirror` (`source_subject_type`,`payload_user_id`);--> statement-breakpoint
CREATE INDEX `grant_mirror_sync_status_synced_at_idx` ON `grant_mirror` (`sync_status`,`synced_at`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`alt` text NOT NULL,
	`low_res_url` text,
	`optimized_url` text,
	`owner` text NOT NULL,
	`url` text,
	`thumbnail_url` text,
	`filename` text NOT NULL,
	`mime_type` text,
	`filesize` integer,
	`width` integer,
	`height` integer,
	`focal_x` real,
	`focal_y` real,
	`status` text DEFAULT 'ready' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`excerpt` text,
	`content_json` text NOT NULL,
	`cover_image` text,
	`author` text NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`author`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_slug_unique` ON `posts` (`slug`);--> statement-breakpoint
CREATE TABLE `relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`relation` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relationships_unique_idx` ON `relationships` (`subject_type`,`subject_id`,`relation`,`object_type`,`object_id`);--> statement-breakpoint
CREATE INDEX `relationships_subject_idx` ON `relationships` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `relationships_object_idx` ON `relationships` (`object_type`,`object_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`full_name` text NOT NULL,
	`avatar` text,
	`bio_json` text,
	`role` text DEFAULT 'user' NOT NULL,
	`better_auth_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_better_auth_user_id_unique` ON `users` (`better_auth_user_id`);