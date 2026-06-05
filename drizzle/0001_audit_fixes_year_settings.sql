ALTER TABLE `year_settings` ADD `proroga_saldo_at` text;--> statement-breakpoint
ALTER TABLE `year_settings` ADD `riduzione_35_comunicata` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `year_settings` ADD `riduzione_35_data_comunicazione` text;