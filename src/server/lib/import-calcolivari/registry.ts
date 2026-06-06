import { and, eq, type SQL } from 'drizzle-orm';
import { yearSettings, clienti, fatture, pagamenti, calendarEntries, budgetItems, spese, dichiarazioni } from '../../db/schema';
import type { MappedRows } from './types';

export interface EntitySpec {
  name: Exclude<keyof MappedRows, 'profiles'>;
  table: any;
  rowsOf: (m: MappedRows) => any[];
  keyOf: (row: any) => string;
  whereOf: (row: any) => SQL;
  touch: boolean;
}

export const CHILD_ENTITIES: EntitySpec[] = [
  { name: 'yearSettings', table: yearSettings, rowsOf: (m) => m.yearSettings, keyOf: (r) => `${r.year}`, whereOf: (r) => and(eq(yearSettings.profileId, r.profileId), eq(yearSettings.year, r.year))!, touch: false },
  { name: 'clienti', table: clienti, rowsOf: (m) => m.clienti, keyOf: (r) => r.id, whereOf: (r) => eq(clienti.id, r.id), touch: true },
  { name: 'fatture', table: fatture, rowsOf: (m) => m.fatture, keyOf: (r) => `${r.annoProgressivo}:${r.progressivo}`, whereOf: (r) => and(eq(fatture.profileId, r.profileId), eq(fatture.annoProgressivo, r.annoProgressivo), eq(fatture.progressivo, r.progressivo))!, touch: true },
  { name: 'pagamenti', table: pagamenti, rowsOf: (m) => m.pagamenti, keyOf: (r) => r.id, whereOf: (r) => eq(pagamenti.id, r.id), touch: true },
  { name: 'calendarEntries', table: calendarEntries, rowsOf: (m) => m.calendarEntries, keyOf: (r) => `${r.year}:${r.month}:${r.day}`, whereOf: (r) => and(eq(calendarEntries.profileId, r.profileId), eq(calendarEntries.year, r.year), eq(calendarEntries.month, r.month), eq(calendarEntries.day, r.day))!, touch: true },
  { name: 'budgetItems', table: budgetItems, rowsOf: (m) => m.budgetItems, keyOf: (r) => r.id, whereOf: (r) => eq(budgetItems.id, r.id), touch: true },
  { name: 'spese', table: spese, rowsOf: (m) => m.spese, keyOf: (r) => r.id, whereOf: (r) => eq(spese.id, r.id), touch: true },
  { name: 'dichiarazioni', table: dichiarazioni, rowsOf: (m) => m.dichiarazioni, keyOf: (r) => `${r.year}`, whereOf: (r) => and(eq(dichiarazioni.profileId, r.profileId), eq(dichiarazioni.year, r.year))!, touch: true },
];
