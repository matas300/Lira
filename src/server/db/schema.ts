import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

// ──────────────────────────── users ────────────────────────────
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso),
});

// ──────────────────────────── sessions ────────────────────────────
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    activeProfileId: text('active_profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull().default(nowIso),
    lastUsedAt: text('last_used_at').notNull().default(nowIso),
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
    expiresIdx: index('sessions_expires_idx').on(t.expiresAt),
  }),
);

// ──────────────────────────── profiles ────────────────────────────
export const profiles = sqliteTable(
  'profiles',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    anagrafica: text('anagrafica'), // JSON
    attivita: text('attivita'), // JSON
    giorniIncasso: integer('giorni_incasso').notNull().default(30),
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => ({
    userSlugIdx: uniqueIndex('profiles_user_slug_idx').on(t.userId, t.slug),
  }),
);

// ──────────────────────────── year_settings ────────────────────────────
export const yearSettings = sqliteTable(
  'year_settings',
  {
    profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    regime: text('regime').notNull(),
    coefficiente: real('coefficiente').notNull(),
    impostaSostitutiva: real('imposta_sostitutiva').notNull(),
    inpsMode: text('inps_mode').notNull(),
    inpsCategoria: text('inps_categoria'),
    riduzione35: integer('riduzione_35').notNull().default(0),
    haRedditoDipendente: integer('ha_reddito_dipendente').notNull().default(0),
    limiteForfettario: integer('limite_forfettario').notNull().default(85000),
    scadenziarioMetodo: text('scadenziario_metodo').notNull().default('storico'),
    primoAnnoFatturatoPrec: real('primo_anno_fatturato_prec'),
    primoAnnoImpostaPrec: real('primo_anno_imposta_prec'),
    primoAnnoAccontiImpostaPrec: real('primo_anno_acconti_imposta_prec'),
    primoAnnoContribVariabiliPrec: real('primo_anno_contrib_variabili_prec'),
    primoAnnoAccontiContribPrec: real('primo_anno_acconti_contrib_prec'),
    overrides: text('overrides'), // JSON
    // Audit fix A5: data proroga saldo+acc1 (es. '2026-07-30').
    prorogaSaldoAt: text('proroga_saldo_at'),
    // Audit fix M1: stato comunicazione INPS della riduzione 35%.
    riduzione35Comunicata: integer('riduzione_35_comunicata').notNull().default(0),
    riduzione35DataComunicazione: text('riduzione_35_data_comunicazione'),
    // Slice B: tariffa giornaliera per "crea fattura dal calendario" (per-anno).
    tariffaGiornaliera: real('tariffa_giornaliera'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.profileId, t.year] }),
  }),
);

// ──────────────────────────── clienti ────────────────────────────
export const clienti = sqliteTable(
  'clienti',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    tipoCliente: text('tipo_cliente').notNull().default('PG'),
    partitaIva: text('partita_iva'),
    codiceFiscale: text('codice_fiscale'),
    codiceSdi: text('codice_sdi'),
    pec: text('pec'),
    indirizzo: text('indirizzo'),
    cap: text('cap'),
    citta: text('citta'),
    provincia: text('provincia'),
    nazione: text('nazione').notNull().default('IT'),
    descrizioneStandard: text('descrizione_standard'),
    isDefault: integer('is_default').notNull().default(0),
    note: text('note'),
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => ({
    profilePivaIdx: uniqueIndex('clienti_profile_piva_idx').on(t.profileId, t.partitaIva),
    profileCfIdx: uniqueIndex('clienti_profile_cf_idx').on(t.profileId, t.codiceFiscale),
  }),
);

// ──────────────────────────── fatture ────────────────────────────
export const fatture = sqliteTable(
  'fatture',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    clienteId: text('cliente_id').references(() => clienti.id, { onDelete: 'set null' }),
    tipoDocumento: text('tipo_documento').notNull().default('TD01'),
    annoProgressivo: integer('anno_progressivo').notNull(),
    progressivo: integer('progressivo'),
    numeroDisplay: text('numero_display'),
    data: text('data').notNull(),
    clienteSnapshot: text('cliente_snapshot'), // JSON
    righe: text('righe').notNull(), // JSON
    importo: real('importo').notNull(),
    ritenuta: real('ritenuta').notNull().default(0),
    aliquotaRitenuta: real('aliquota_ritenuta'),
    tipoRitenuta: text('tipo_ritenuta'),
    causaleRitenuta: text('causale_ritenuta'),
    contributoIntegrativo: real('contributo_integrativo').notNull().default(0),
    marcaDaBollo: integer('marca_da_bollo').notNull().default(0),
    bolloAddebitato: integer('bollo_addebitato').notNull().default(0),
    stato: text('stato').notNull().default('bozza'),
    dataInvioSdi: text('data_invio_sdi'),
    dataPagamento: text('data_pagamento'),
    pagMese: integer('pag_mese'),
    pagAnno: integer('pag_anno'),
    modalitaPagamento: text('modalita_pagamento'),
    fatturaOriginaleId: text('fattura_originale_id').references((): AnySQLiteColumn => fatture.id, { onDelete: 'set null' }),
    tipoStorno: text('tipo_storno'),
    ncTotaleImporto: real('nc_totale_importo').notNull().default(0),
    ncIds: text('nc_ids'), // JSON
    origine: text('origine').notNull().default('manuale'),
    note: text('note'),
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => ({
    progressivoIdx: uniqueIndex('fatture_progressivo_idx').on(t.profileId, t.annoProgressivo, t.progressivo),
    pagAnnoMeseIdx: index('fatture_pag_anno_mese_idx').on(t.profileId, t.pagAnno, t.pagMese),
    statoIdx: index('fatture_stato_idx').on(t.profileId, t.stato),
  }),
);

// ──────────────────────────── pagamenti ────────────────────────────
export const pagamenti = sqliteTable(
  'pagamenti',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    data: text('data').notNull(),
    tipo: text('tipo').notNull(),
    descrizione: text('descrizione'),
    importo: real('importo').notNull(),
    scheduleKey: text('schedule_key'),
    linkedKeys: text('linked_keys'), // JSON
    note: text('note'),
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => ({
    profileYearIdx: index('pagamenti_profile_year_idx').on(t.profileId, t.year),
    scheduleKeyIdx: index('pagamenti_schedule_key_idx').on(t.profileId, t.scheduleKey),
  }),
);

// ──────────────────────────── calendar_entries ────────────────────────────
export const calendarEntries = sqliteTable(
  'calendar_entries',
  {
    profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    month: integer('month').notNull(),
    day: integer('day').notNull(),
    activityCode: text('activity_code').notNull(),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.profileId, t.year, t.month, t.day] }),
  }),
);

// ──────────────────────────── budget_items ────────────────────────────
export const budgetItems = sqliteTable('budget_items', {
  id: text('id').primaryKey(),
  profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  nome: text('nome').notNull(),
  importo: real('importo').notNull(),
  auto: integer('auto').notNull().default(0),
  ordine: integer('ordine').notNull().default(0),
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso),
});

// ──────────────────────────── spese ────────────────────────────
export const spese = sqliteTable('spese', {
  id: text('id').primaryKey(),
  profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  titolo: text('titolo').notNull(),
  costo: real('costo').notNull(),
  deducibilita: real('deducibilita').notNull(),
  anni: integer('anni').notNull().default(1),
  categoria: text('categoria'),
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso),
});

// ──────────────────────────── dichiarazioni ────────────────────────────
export const dichiarazioni = sqliteTable(
  'dichiarazioni',
  {
    profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    tipo: text('tipo').notNull().default('ordinaria'),
    flags: text('flags'), // JSON
    contiEsteri: text('conti_esteri'), // JSON
    overrides: text('overrides'), // JSON
    statoCompilazione: text('stato_compilazione'), // JSON
    confirmedWarnings: text('confirmed_warnings'), // JSON
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.profileId, t.year] }),
  }),
);
