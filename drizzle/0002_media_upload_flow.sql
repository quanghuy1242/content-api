ALTER TABLE `media` ADD `original_key` text;
--> statement-breakpoint
ALTER TABLE `media` ADD `variant_keys_json` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `media` ADD `upload_expires_at` integer;
--> statement-breakpoint
ALTER TABLE `media` ADD `version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `media` ADD `failure_reason` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `media_original_key_unique` ON `media` (`original_key`);
--> statement-breakpoint
CREATE INDEX `media_status_upload_expires_idx` ON `media` (`status`,`upload_expires_at`);
