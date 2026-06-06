import type { profiles, yearSettings, clienti, fatture, pagamenti, calendarEntries, budgetItems, spese, dichiarazioni } from '../../db/schema';

export interface RawExport {
  profileName: string;
  keys: Record<string, unknown>;
}

export interface YearDoc {
  year: number;
  data: Record<string, any>;
}

export interface ExtractedData {
  profileName: string;
  anagrafica: Record<string, any>;
  attivita: Record<string, any>;
  fiscal: Record<string, any>;
  regime: string | null;
  displayName: string | null;
  giorniIncasso: number;
  yearSettings: Array<{ year: number; settings: Record<string, any> }>;
  clienti: Array<Record<string, any>>;
  clienteDefaultId: string | null;
  fatture: Array<Record<string, any>>;
  pagamenti: Array<{ year: number } & Record<string, any>>;
  calendar: Array<{ year: number; month: number; day: number; code: string }>;
  budget: Array<{ year: number; nome: any; importo: any; auto: any; ordine: number }>;
  spese: Array<{ year: number } & Record<string, any>>;
  dichiarazioni: Array<{ year: number; dichiarazione: Record<string, any> }>;
}

export interface ImportIssue {
  entity: string;
  sourceKey: string;
  reason: string;
}

export type ProfileRow = typeof profiles.$inferInsert;
export type YearSettingsRow = typeof yearSettings.$inferInsert;
export type ClienteRow = typeof clienti.$inferInsert;
export type FatturaRow = typeof fatture.$inferInsert;
export type PagamentoRow = typeof pagamenti.$inferInsert;
export type CalendarRow = typeof calendarEntries.$inferInsert;
export type BudgetRow = typeof budgetItems.$inferInsert;
export type SpesaRow = typeof spese.$inferInsert;
export type DichiarazioneRow = typeof dichiarazioni.$inferInsert;

export interface MappedRows {
  profiles: ProfileRow[];
  yearSettings: YearSettingsRow[];
  clienti: ClienteRow[];
  fatture: FatturaRow[];
  pagamenti: PagamentoRow[];
  calendarEntries: CalendarRow[];
  budgetItems: BudgetRow[];
  spese: SpesaRow[];
  dichiarazioni: DichiarazioneRow[];
}

export type ChildEntityName = Exclude<keyof MappedRows, 'profiles'>;

export interface EntityPlan {
  entity: string;
  inserts: any[];
  updates: any[];
  identical: number;
}

export type ProfileOp = 'insert' | 'update' | 'identical';

export interface ImportPlan {
  profileName: string;
  userId: string;
  profileId: string;
  slug: string;
  profileOp: ProfileOp;
  profileRow: ProfileRow;
  entities: Record<string, EntityPlan>;
  issues: ImportIssue[];
}
