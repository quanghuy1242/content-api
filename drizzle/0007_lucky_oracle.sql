ALTER TABLE `books` ADD `published_at` integer;--> statement-breakpoint
ALTER TABLE `books` ADD `scheduled_at` integer;--> statement-breakpoint
ALTER TABLE `books` ADD `archived_at` integer;--> statement-breakpoint
CREATE INDEX `books_scheduled_idx` ON `books` (`scheduled_at`) WHERE status = 'scheduled';--> statement-breakpoint
ALTER TABLE `posts` ADD `scheduled_at` integer;--> statement-breakpoint
ALTER TABLE `posts` ADD `archived_at` integer;--> statement-breakpoint
CREATE INDEX `posts_scheduled_idx` ON `posts` (`scheduled_at`) WHERE status = 'scheduled';