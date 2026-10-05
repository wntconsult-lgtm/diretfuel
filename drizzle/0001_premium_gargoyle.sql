CREATE TABLE `deleted_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`collection` text NOT NULL,
	`record_id` text NOT NULL,
	`data` text NOT NULL,
	`deleted_at` text NOT NULL,
	`deleted_by` text NOT NULL,
	`restored_at` text,
	`restored_by` text
);
--> statement-breakpoint
CREATE INDEX `idx_deleted_records_workspace_deleted` ON `deleted_records` (`workspace_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `security_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`created_at` text NOT NULL,
	`user_email` text NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`detail` text NOT NULL,
	`state_version` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_security_audit_workspace_created` ON `security_audit` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `state_backups` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`state_version` integer NOT NULL,
	`object_key` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`size_bytes` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_state_backups_workspace_created` ON `state_backups` (`workspace_id`,`created_at`);