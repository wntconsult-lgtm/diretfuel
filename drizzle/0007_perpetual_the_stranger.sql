CREATE TABLE `document_removals` (
	`object_key` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`status` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`bytes` integer NOT NULL,
	`etag` text NOT NULL,
	`detail` text NOT NULL
);
