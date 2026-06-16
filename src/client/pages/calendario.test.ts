// src/client/pages/calendario.test.ts
// TDD tests for pure render functions in calendario.ts
// Run: npx tsx --test src/client/pages/calendario.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveCode, renderMonth, renderLegend, renderCalendario } from './calendario';

// ─── effectiveCode ───

test('effectiveCode: usa override se presente nella map', () => {
  const map = new Map([['3-10', 'F']]);
  assert.equal(effectiveCode(map, 2025, 3, 10), 'F');
});

test('effectiveCode: usa default se non presente (sabato → WE)', () => {
  // 2025-03-15 = sabato
  const map = new Map<string, string>();
  assert.equal(effectiveCode(map, 2025, 3, 15), 'WE');
});

test('effectiveCode: usa default se non presente (mercoledì → 8)', () => {
  // 2025-03-12 = mercoledì
  const map = new Map<string, string>();
  assert.equal(effectiveCode(map, 2025, 3, 12), '8');
});

test('effectiveCode: usa default se non presente (festivo → FS)', () => {
  // 2025-12-25 = giovedì, Natale → FS
  const map = new Map<string, string>();
  assert.equal(effectiveCode(map, 2025, 12, 25), 'FS');
});

// ─── renderMonth ───

const EMPTY_MAP = new Map<string, string>();
const TODAY_NOT_IN_JAN = '2025-06-16'; // non a Gennaio

test('renderMonth: contiene 31 celle giorno per Gennaio 2025', () => {
  const html = renderMonth(2025, 1, EMPTY_MAP, TODAY_NOT_IN_JAN);
  // Conta le occorrenze di data-day=
  const matches = html.match(/data-day="/g);
  assert.equal(matches?.length, 31);
});

test('renderMonth: contiene "Gennaio" nell\'header', () => {
  const html = renderMonth(2025, 1, EMPTY_MAP, TODAY_NOT_IN_JAN);
  assert.ok(html.includes('Gennaio'), 'Dovrebbe contenere "Gennaio"');
});

test('renderMonth: un giorno con override F ha classe act-F', () => {
  const map = new Map([['1-15', 'F']]);
  const html = renderMonth(2025, 1, map, TODAY_NOT_IN_JAN);
  assert.ok(html.includes('act-F'), 'Dovrebbe avere classe act-F');
});

test('renderMonth: il giorno oggi ha classe today', () => {
  // 2025-01-15 = mercoledì → non WE, non festivo
  const html = renderMonth(2025, 1, EMPTY_MAP, '2025-01-15');
  assert.ok(html.includes('today'), 'Dovrebbe contenere classe today');
});

test('renderMonth: il giorno oggi non ha today se today è in altro mese', () => {
  const html = renderMonth(2025, 1, EMPTY_MAP, '2025-06-16');
  assert.ok(!html.includes('today'), 'Non dovrebbe avere today se today è in altro mese');
});

test('renderMonth: summary contiene il conteggio lavorativi', () => {
  // Gennaio 2025: 1/1 è CapodAnno (festivo), 4/5/11/12/18/19/25/26 = WE (8 weekend sabati/domeniche)
  // lavorativi ~ 21 giorni
  const html = renderMonth(2025, 1, EMPTY_MAP, TODAY_NOT_IN_JAN);
  assert.ok(html.includes('lav'), 'Summary dovrebbe contenere "lav"');
});

test('renderMonth: summary mostra WE count', () => {
  const html = renderMonth(2025, 1, EMPTY_MAP, TODAY_NOT_IN_JAN);
  assert.ok(html.includes('WE'), 'Summary dovrebbe mostrare conteggio WE');
});

test('renderMonth: summary ferie non appare se zero', () => {
  // Senza override di tipo F, nessuna ferie
  const html = renderMonth(2025, 3, EMPTY_MAP, TODAY_NOT_IN_JAN);
  // WE sempre appare; ferie solo se > 0
  // "ferie" nella stringa summary non deve apparire se nessun override F
  // (il summary mostra solo valori non-zero per F, FS, M, Malattia, Donazione)
  // ma 25/4 Liberazione = FS → FS ci sarà in aprile; in Marzo nessun festivo fisso non-WE
  // In marzo 2025 c'è Pasquetta? No (Pasqua 2025 = 20/4). Quindi in marzo no festivi.
  // Quindi "fest" e "ferie" non appaiono.
  // Ma controlliamo solo che "ferie" non appaia senza override F
  const ferieSummary = html.match(/class="badge badge-F">/g);
  assert.equal(ferieSummary, null, 'Non dovrebbe avere badge ferie senza override F');
});

test('renderMonth: con override Malattia appare "mal" nel summary', () => {
  const map = new Map([['3-12', 'Malattia']]);
  const html = renderMonth(2025, 3, map, TODAY_NOT_IN_JAN);
  assert.ok(html.includes('mal'), 'Summary dovrebbe contenere "mal"');
});

test('renderMonth: Febbraio 2025 ha 28 celle giorno', () => {
  const html = renderMonth(2025, 2, EMPTY_MAP, TODAY_NOT_IN_JAN);
  const matches = html.match(/data-day="/g);
  assert.equal(matches?.length, 28);
});

test('renderMonth: celle vuote di offset prima del primo giorno', () => {
  // 1 Gennaio 2025 = mercoledì (dow=3, offset lunedì-based = 2)
  // Quindi ci dovrebbero essere 2 celle empty prima
  const html = renderMonth(2025, 1, EMPTY_MAP, TODAY_NOT_IN_JAN);
  const emptyMatches = html.match(/cal-day empty/g);
  assert.equal(emptyMatches?.length ?? 0, 2, 'Dovrebbero esserci 2 celle empty per Gennaio 2025');
});

// ─── renderLegend ───

test('renderLegend: contiene tutti i codici', () => {
  const html = renderLegend();
  assert.ok(html.includes('Lavoro'), 'Dovrebbe contenere "Lavoro"');
  assert.ok(html.includes('Weekend'), 'Dovrebbe contenere "Weekend"');
  assert.ok(html.includes('Ferie'), 'Dovrebbe contenere "Ferie"');
  assert.ok(html.includes('Festivo'), 'Dovrebbe contenere "Festivo"');
  assert.ok(html.includes('Malattia'), 'Dovrebbe contenere "Malattia"');
  assert.ok(html.includes('Donazione'), 'Dovrebbe contenere "Donazione"');
});

// ─── renderCalendario ───

test('renderCalendario: contiene 12 mesi', () => {
  const html = renderCalendario(2025, EMPTY_MAP, TODAY_NOT_IN_JAN);
  // Conta le occorrenze di "month-card"
  const matches = html.match(/class="month-card"/g);
  assert.equal(matches?.length, 12, 'Dovrebbero esserci 12 month-card');
});

test('renderCalendario: contiene la legenda', () => {
  const html = renderCalendario(2025, EMPTY_MAP, TODAY_NOT_IN_JAN);
  assert.ok(html.includes('Lavoro'), 'Dovrebbe contenere la legenda');
});
