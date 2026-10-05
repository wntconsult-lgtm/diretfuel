CREATE TABLE `volume_parameters` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`data` text NOT NULL,
	`changes` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `volume_parameters_version` ON `volume_parameters` (`workspace_id`,`version`);--> statement-breakpoint
CREATE TABLE `volume_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`record_key` text NOT NULL,
	`status` text NOT NULL,
	`observation` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `volume_reviews_record` ON `volume_reviews` (`workspace_id`,`record_key`);