CREATE TABLE `idempotency_keys` (
	`key` text NOT NULL,
	`actor_id` text NOT NULL,
	`route` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_json` text,
	`status` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`key`, `actor_id`, `route`)
);
--> statement-breakpoint
CREATE INDEX `idempotency_actor_route_expires_idx` ON `idempotency_keys` (`actor_id`,`route`,`expires_at`);
