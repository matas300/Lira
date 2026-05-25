CREATE TABLE `budget_items` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`year` integer NOT NULL,
	`nome` text NOT NULL,
	`importo` real NOT NULL,
	`auto` integer DEFAULT 0 NOT NULL,
	`ordine` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `calendar_entries` (
	`profile_id` text NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`day` integer NOT NULL,
	`activity_code` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`profile_id`, `year`, `month`, `day`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `clienti` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`nome` text NOT NULL,
	`tipo_cliente` text DEFAULT 'PG' NOT NULL,
	`partita_iva` text,
	`codice_fiscale` text,
	`codice_sdi` text,
	`pec` text,
	`indirizzo` text,
	`cap` text,
	`citta` text,
	`provincia` text,
	`nazione` text DEFAULT 'IT' NOT NULL,
	`descrizione_standard` text,
	`is_default` integer DEFAULT 0 NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clienti_profile_piva_idx` ON `clienti` (`profile_id`,`partita_iva`);--> statement-breakpoint
CREATE UNIQUE INDEX `clienti_profile_cf_idx` ON `clienti` (`profile_id`,`codice_fiscale`);--> statement-breakpoint
CREATE TABLE `dichiarazioni` (
	`profile_id` text NOT NULL,
	`year` integer NOT NULL,
	`tipo` text DEFAULT 'ordinaria' NOT NULL,
	`flags` text,
	`conti_esteri` text,
	`overrides` text,
	`stato_compilazione` text,
	`confirmed_warnings` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`profile_id`, `year`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fatture` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`cliente_id` text,
	`tipo_documento` text DEFAULT 'TD01' NOT NULL,
	`anno_progressivo` integer NOT NULL,
	`progressivo` integer NOT NULL,
	`numero_display` text NOT NULL,
	`data` text NOT NULL,
	`cliente_snapshot` text,
	`righe` text NOT NULL,
	`importo` real NOT NULL,
	`ritenuta` real DEFAULT 0 NOT NULL,
	`aliquota_ritenuta` real,
	`tipo_ritenuta` text,
	`causale_ritenuta` text,
	`contributo_integrativo` real DEFAULT 0 NOT NULL,
	`marca_da_bollo` integer DEFAULT 0 NOT NULL,
	`bollo_addebitato` integer DEFAULT 0 NOT NULL,
	`stato` text DEFAULT 'bozza' NOT NULL,
	`data_invio_sdi` text,
	`data_pagamento` text,
	`pag_mese` integer,
	`pag_anno` integer,
	`modalita_pagamento` text,
	`fattura_originale_id` text,
	`tipo_storno` text,
	`nc_totale_importo` real DEFAULT 0 NOT NULL,
	`nc_ids` text,
	`origine` text DEFAULT 'manuale' NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `clienti`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`fattura_originale_id`) REFERENCES `fatture`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fatture_progressivo_idx` ON `fatture` (`profile_id`,`anno_progressivo`,`progressivo`);--> statement-breakpoint
CREATE INDEX `fatture_pag_anno_mese_idx` ON `fatture` (`profile_id`,`pag_anno`,`pag_mese`);--> statement-breakpoint
CREATE INDEX `fatture_stato_idx` ON `fatture` (`profile_id`,`stato`);--> statement-breakpoint
CREATE TABLE `pagamenti` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`year` integer NOT NULL,
	`data` text NOT NULL,
	`tipo` text NOT NULL,
	`descrizione` text,
	`importo` real NOT NULL,
	`schedule_key` text,
	`linked_keys` text,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pagamenti_profile_year_idx` ON `pagamenti` (`profile_id`,`year`);--> statement-breakpoint
CREATE INDEX `pagamenti_schedule_key_idx` ON `pagamenti` (`profile_id`,`schedule_key`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`slug` text NOT NULL,
	`display_name` text NOT NULL,
	`anagrafica` text,
	`attivita` text,
	`giorni_incasso` integer DEFAULT 30 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_user_slug_idx` ON `profiles` (`user_id`,`slug`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`active_profile_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_used_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `spese` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`year` integer NOT NULL,
	`titolo` text NOT NULL,
	`costo` real NOT NULL,
	`deducibilita` real NOT NULL,
	`anni` integer DEFAULT 1 NOT NULL,
	`categoria` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `year_settings` (
	`profile_id` text NOT NULL,
	`year` integer NOT NULL,
	`regime` text NOT NULL,
	`coefficiente` real NOT NULL,
	`imposta_sostitutiva` real NOT NULL,
	`inps_mode` text NOT NULL,
	`inps_categoria` text,
	`riduzione_35` integer DEFAULT 0 NOT NULL,
	`ha_reddito_dipendente` integer DEFAULT 0 NOT NULL,
	`limite_forfettario` integer DEFAULT 85000 NOT NULL,
	`scadenziario_metodo` text DEFAULT 'storico' NOT NULL,
	`primo_anno_fatturato_prec` real,
	`primo_anno_imposta_prec` real,
	`primo_anno_acconti_imposta_prec` real,
	`primo_anno_contrib_variabili_prec` real,
	`primo_anno_acconti_contrib_prec` real,
	`overrides` text,
	PRIMARY KEY(`profile_id`, `year`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
