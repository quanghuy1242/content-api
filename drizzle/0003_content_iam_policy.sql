CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`title` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `books_org_status_idx` ON `books` (`org_id`,`status`);--> statement-breakpoint
CREATE INDEX `books_created_by_idx` ON `books` (`created_by_user_id`);--> statement-breakpoint
CREATE TABLE `content_permissions` (
	`key` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`delegation_class` text NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `content_policy_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`principal_type` text NOT NULL,
	`principal_id` text NOT NULL,
	`role_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`expires_at` integer,
	`created_by_type` text NOT NULL,
	`created_by_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `content_roles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_policy_bindings_unique_idx` ON `content_policy_bindings` (`org_id`,`principal_type`,`principal_id`,`role_id`,`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `content_policy_bindings_principal_idx` ON `content_policy_bindings` (`org_id`,`principal_type`,`principal_id`,`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `content_policy_bindings_resource_idx` ON `content_policy_bindings` (`org_id`,`resource_type`,`resource_id`,`role_id`);--> statement-breakpoint
CREATE INDEX `content_policy_bindings_expiry_idx` ON `content_policy_bindings` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `content_policy_bindings_single_book_owner_idx` ON `content_policy_bindings` (`org_id`,`resource_type`,`resource_id`) WHERE "content_policy_bindings"."resource_type" = 'book' AND "content_policy_bindings"."role_id" = 'system:book.owner';--> statement-breakpoint
CREATE TABLE `content_policy_denials` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`principal_type` text NOT NULL,
	`principal_id` text NOT NULL,
	`permission_key` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`applies_to_descendants` integer NOT NULL,
	`expires_at` integer,
	`reason` text,
	`created_by_type` text NOT NULL,
	`created_by_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`permission_key`) REFERENCES `content_permissions`(`key`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_policy_denials_unique_idx` ON `content_policy_denials` (`org_id`,`principal_type`,`principal_id`,`permission_key`,`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `content_policy_denials_lookup_idx` ON `content_policy_denials` (`org_id`,`principal_type`,`principal_id`,`permission_key`,`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `content_policy_denials_expiry_idx` ON `content_policy_denials` (`expires_at`);--> statement-breakpoint
CREATE TABLE `content_policy_events` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`request_id` text,
	`reason` text,
	`snapshot_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `content_policy_events_target_idx` ON `content_policy_events` (`org_id`,`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `content_policy_events_actor_idx` ON `content_policy_events` (`org_id`,`actor_type`,`actor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `content_role_permissions` (
	`role_id` text NOT NULL,
	`permission_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `content_roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`permission_key`) REFERENCES `content_permissions`(`key`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_role_permissions_unique_idx` ON `content_role_permissions` (`role_id`,`permission_key`);--> statement-breakpoint
CREATE TABLE `content_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`assignable_resource_type` text NOT NULL,
	`built_in` integer NOT NULL,
	`enabled` integer NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_roles_namespace_key_idx` ON `content_roles` (`namespace_id`,`key`);--> statement-breakpoint
CREATE INDEX `content_roles_resource_type_idx` ON `content_roles` (`assignable_resource_type`,`enabled`);--> statement-breakpoint
DROP INDEX `users_better_auth_user_id_unique`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `better_auth_user_id`;