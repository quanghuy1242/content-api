ALTER TABLE `categories` ADD `org_id` text NOT NULL DEFAULT 'legacy';--> statement-breakpoint
ALTER TABLE `media` ADD `org_id` text NOT NULL DEFAULT 'legacy';--> statement-breakpoint
ALTER TABLE `posts` ADD `org_id` text NOT NULL DEFAULT 'legacy';
