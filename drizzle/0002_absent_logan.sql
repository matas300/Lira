DROP INDEX IF EXISTS "clienti_profile_piva_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "clienti_profile_cf_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "fatture_progressivo_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "fatture_pag_anno_mese_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "fatture_stato_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "pagamenti_profile_year_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "pagamenti_schedule_key_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "profiles_user_slug_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "sessions_user_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "sessions_expires_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "users_email_unique";--> statement-breakpoint
ALTER TABLE `fatture` ALTER COLUMN "progressivo" TO "progressivo" integer;--> statement-breakpoint
CREATE UNIQUE INDEX `clienti_profile_piva_idx` ON `clienti` (`profile_id`,`partita_iva`);--> statement-breakpoint
CREATE UNIQUE INDEX `clienti_profile_cf_idx` ON `clienti` (`profile_id`,`codice_fiscale`);--> statement-breakpoint
CREATE UNIQUE INDEX `fatture_progressivo_idx` ON `fatture` (`profile_id`,`anno_progressivo`,`progressivo`);--> statement-breakpoint
CREATE INDEX `fatture_pag_anno_mese_idx` ON `fatture` (`profile_id`,`pag_anno`,`pag_mese`);--> statement-breakpoint
CREATE INDEX `fatture_stato_idx` ON `fatture` (`profile_id`,`stato`);--> statement-breakpoint
CREATE INDEX `pagamenti_profile_year_idx` ON `pagamenti` (`profile_id`,`year`);--> statement-breakpoint
CREATE INDEX `pagamenti_schedule_key_idx` ON `pagamenti` (`profile_id`,`schedule_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_user_slug_idx` ON `profiles` (`user_id`,`slug`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
ALTER TABLE `fatture` ALTER COLUMN "numero_display" TO "numero_display" text;