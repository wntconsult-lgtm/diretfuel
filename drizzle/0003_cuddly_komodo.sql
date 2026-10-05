CREATE TABLE `ticketlog_fuelings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`transaction_code` text NOT NULL,
	`client_code` text,
	`client_name` text,
	`occurred_on` text NOT NULL,
	`plate` text NOT NULL,
	`directorate` text,
	`responsible` text,
	`fleet_type` text,
	`vehicle_model` text,
	`service` text NOT NULL,
	`product` text,
	`driver_code` text,
	`driver_name` text,
	`original_price` real,
	`liters` real NOT NULL,
	`final_price` real,
	`final_value` real,
	`odometer` real,
	`station_code` text NOT NULL,
	`station_name` text NOT NULL,
	`city` text,
	`uf` text,
	`vehicle_link_status` text NOT NULL,
	`vehicle_id` text,
	`import_batch_id` text NOT NULL,
	`imported_at` text NOT NULL,
	`imported_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ticketlog_fuelings_workspace_transaction` ON `ticketlog_fuelings` (`workspace_id`,`transaction_code`);--> statement-breakpoint
CREATE INDEX `idx_ticketlog_fuelings_workspace_date` ON `ticketlog_fuelings` (`workspace_id`,`occurred_on`);--> statement-breakpoint
CREATE INDEX `idx_ticketlog_fuelings_workspace_plate` ON `ticketlog_fuelings` (`workspace_id`,`plate`);--> statement-breakpoint
CREATE INDEX `idx_ticketlog_fuelings_workspace_station` ON `ticketlog_fuelings` (`workspace_id`,`station_code`);--> statement-breakpoint
CREATE INDEX `idx_ticketlog_fuelings_workspace_link` ON `ticketlog_fuelings` (`workspace_id`,`vehicle_link_status`);--> statement-breakpoint
CREATE TABLE `ticketlog_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`filename` text NOT NULL,
	`imported` integer NOT NULL,
	`duplicated` integer NOT NULL,
	`rejected` integer NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ticketlog_batches_workspace_created` ON `ticketlog_import_batches` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ticketlog_stations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_code` text NOT NULL,
	`name` text NOT NULL,
	`cnpj` text,
	`address` text,
	`neighborhood` text,
	`city` text NOT NULL,
	`uf` text NOT NULL,
	`cep` text,
	`latitude` real,
	`longitude` real,
	`geocode_status` text DEFAULT 'Pendente' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ticketlog_stations_workspace_code` ON `ticketlog_stations` (`workspace_id`,`source_code`);--> statement-breakpoint
CREATE INDEX `idx_ticketlog_stations_workspace_city` ON `ticketlog_stations` (`workspace_id`,`city`,`uf`);