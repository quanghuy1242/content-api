CREATE TABLE `content_iam_bootstrap_organizations` (
	`org_id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `content_iam_bootstrap_organizations` (`org_id`)
SELECT DISTINCT `org_id`
FROM `content_policy_bindings`
WHERE `role_id` = 'system:org.content_admin'
	AND `resource_type` = 'org';
--> statement-breakpoint
CREATE TRIGGER `content_roles_version_guard`
BEFORE UPDATE OF `version` ON `content_roles`
WHEN OLD.`built_in` = 0 AND NEW.`version` <> OLD.`version` + 1
BEGIN
	SELECT RAISE(ABORT, 'content_iam_role_version_conflict');
END;
--> statement-breakpoint
CREATE TRIGGER `content_policy_bindings_enabled_role_guard`
BEFORE INSERT ON `content_policy_bindings`
WHEN NOT EXISTS (
	SELECT 1
	FROM `content_roles` AS `role`
	WHERE `role`.`id` = NEW.`role_id`
		AND `role`.`enabled` = 1
)
BEGIN
	SELECT RAISE(ABORT, 'content_iam_disabled_role_binding');
END;
--> statement-breakpoint
CREATE TRIGGER `content_roles_disable_active_bindings_guard`
BEFORE UPDATE OF `enabled` ON `content_roles`
WHEN OLD.`enabled` = 1
	AND NEW.`enabled` = 0
	AND EXISTS (
		SELECT 1
		FROM `content_policy_bindings` AS `binding`
		WHERE `binding`.`role_id` = OLD.`id`
			AND (`binding`.`expires_at` IS NULL OR `binding`.`expires_at` > (unixepoch() * 1000))
	)
BEGIN
	SELECT RAISE(ABORT, 'content_iam_role_has_active_bindings');
END;
--> statement-breakpoint
CREATE TRIGGER `content_policy_bindings_last_admin_guard`
BEFORE DELETE ON `content_policy_bindings`
WHEN OLD.`role_id` = 'system:org.content_admin'
	AND OLD.`resource_type` = 'org'
	AND (OLD.`expires_at` IS NULL OR OLD.`expires_at` > (unixepoch() * 1000))
	AND NOT EXISTS (
		SELECT 1
		FROM `content_policy_bindings` AS `other`
		WHERE `other`.`id` <> OLD.`id`
			AND `other`.`org_id` = OLD.`org_id`
			AND `other`.`role_id` = 'system:org.content_admin'
			AND `other`.`resource_type` = 'org'
			AND `other`.`resource_id` = OLD.`resource_id`
			AND (`other`.`expires_at` IS NULL OR `other`.`expires_at` > (unixepoch() * 1000))
	)
BEGIN
	SELECT RAISE(ABORT, 'content_iam_last_admin');
END;
--> statement-breakpoint
CREATE TRIGGER `content_policy_events_denied_rate_limit`
BEFORE INSERT ON `content_policy_events`
WHEN NEW.`action` = 'policy.mutation_denied'
	AND (
		SELECT COUNT(*)
		FROM `content_policy_events` AS `recent`
		WHERE `recent`.`action` = 'policy.mutation_denied'
			AND `recent`.`org_id` = NEW.`org_id`
			AND `recent`.`target_type` = NEW.`target_type`
			AND `recent`.`target_id` = NEW.`target_id`
			AND `recent`.`actor_type` = NEW.`actor_type`
			AND `recent`.`actor_id` = NEW.`actor_id`
			AND `recent`.`created_at` > ((unixepoch() * 1000) - 60000)
	) >= 5
BEGIN
	SELECT RAISE(ABORT, 'content_iam_denied_event_rate_limited');
END;
