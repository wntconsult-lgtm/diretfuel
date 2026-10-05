ALTER TABLE `ticketlog_fuelings` ADD `occurred_time` text;--> statement-breakpoint
ALTER TABLE `ticketlog_import_batches` ADD `updated` integer DEFAULT 0 NOT NULL;