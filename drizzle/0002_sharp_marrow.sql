CREATE TABLE `access_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_email` text NOT NULL,
	`display_name` text,
	`event` text NOT NULL,
	`route` text NOT NULL,
	`created_at` text NOT NULL,
	`user_agent` text
);
--> statement-breakpoint
CREATE INDEX `idx_access_logs_workspace_created` ON `access_logs` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_access_logs_workspace_user` ON `access_logs` (`workspace_id`,`user_email`);