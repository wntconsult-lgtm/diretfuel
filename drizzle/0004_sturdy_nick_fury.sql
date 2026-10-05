CREATE TABLE `geo_route_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`origin_code` text NOT NULL,
	`alternative_id` text NOT NULL,
	`distance_km` real,
	`duration_minutes` real,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`calculated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_geo_route_workspace_pair` ON `geo_route_cache` (`workspace_id`,`origin_code`,`alternative_id`);--> statement-breakpoint
CREATE INDEX `idx_geo_route_workspace_origin` ON `geo_route_cache` (`workspace_id`,`origin_code`);--> statement-breakpoint
CREATE INDEX `idx_geo_route_workspace_status` ON `geo_route_cache` (`workspace_id`,`status`);