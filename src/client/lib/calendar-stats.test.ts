// src/client/lib/calendar-stats.test.ts
// TDD tests for calendar-stats.ts
// Run: npx tsx --test src/client/lib/calendar-stats.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyWorkStats } from './calendar-stats';

// Helper: conta i giorni lavorativi (feriali non festivi) di un mese 2025
// Verificato manualmente per i mesi usati nei test:
//   Gennaio 2025:  1/1=Cap(FS), 6/1=Epif(FS), resto feriali non festivi = 21 gg
//   Febbraio 2025: 28 giorni; festività: nessuna; weekend: 4+4=8; lavorativi = 20
//   Marzo 2025:    31 giorni; festività: nessuna; weekend: 9; lavorativi = 21
// (Non è un helper da importare, è solo documentazione per i test.)

test('mese senza override → worked = giorni feriali non festivi (Gen 2025 = 21)', () => {
  const stats = monthlyWorkStats(2025, new Map());
  const gen = stats[0]!;
  assert.equal(gen.month, 1);
  // Gennaio 2025: 31 giorni, 9 weekend (4 sab 4 dom + 1 dom=5 dom 4 sab = 9),
  // festività: 1/1 (mer), 6/1 (lun) = 2 festivi non-weekend
  // Lavorativi = 31 - 9(WE) - 2(FS non-WE) = 20? let's compute carefully:
  // Gen 2025: 1=mer(FS), 2=gio, 3=ven, 4=sab(WE), 5=dom(WE),
  // 6=lun(FS), 7=mar, 8=mer, 9=gio, 10=ven, 11=sab(WE), 12=dom(WE),
  // 13=lun, 14=mar, 15=mer, 16=gio, 17=ven, 18=sab(WE), 19=dom(WE),
  // 20=lun, 21=mar, 22=mer, 23=gio, 24=ven, 25=sab(WE), 26=dom(WE),
  // 27=lun, 28=mar, 29=mer, 30=gio, 31=ven
  // WE: 4,5,11,12,18,19,25,26 = 8 giorni
  // FS non-WE: 1 (mer), 6 (lun) = 2 giorni
  // Lavorativi = 31 - 8 - 2 = 21
  assert.equal(gen.worked, 21);
  assert.equal(gen.half, 0);
});

test('override "8"→"F" riduce worked di 1 (giorno intero diventa ferie)', () => {
  // Gennaio 2025: mese con 21 lavorativi senza override
  // Override: 2 giorni '8' → 'F' (2 feriali diventano ferie)
  const overrides = new Map<string, string>([
    ['1-2', 'F'],  // 2 gen (giovedì) → Ferie
    ['1-3', 'F'],  // 3 gen (venerdì) → Ferie
  ]);
  const stats = monthlyWorkStats(2025, overrides);
  const gen = stats[0]!;
  assert.equal(gen.month, 1);
  assert.equal(gen.worked, 19); // 21 - 2 = 19
  assert.equal(gen.half, 0);
});

test('override "8"→"M" sposta 1 da worked a half', () => {
  // Gennaio 2025: 1 giorno '8' → 'M'
  const overrides = new Map<string, string>([
    ['1-7', 'M'],  // 7 gen (martedì) → Mezza giornata
  ]);
  const stats = monthlyWorkStats(2025, overrides);
  const gen = stats[0]!;
  assert.equal(gen.month, 1);
  assert.equal(gen.worked, 20); // 21 - 1 = 20
  assert.equal(gen.half, 1);
});

test('override "8"→"M" e "8"→"F" in mesi diversi', () => {
  // Gennaio: 1 giorno → Mezza; Febbraio: 1 giorno → Ferie
  const overrides = new Map<string, string>([
    ['1-7', 'M'],   // gen: martedì → Mezza
    ['2-3', 'F'],   // feb: lunedì → Ferie
  ]);
  const stats = monthlyWorkStats(2025, overrides);
  const gen = stats[0]!;
  const feb = stats[1]!;
  assert.equal(gen.month, 1);
  assert.equal(gen.worked, 20);
  assert.equal(gen.half, 1);
  assert.equal(feb.month, 2);
  // Febbraio 2025: 28 giorni
  // 1=sab(WE), 2=dom(WE), 3=lun, 4=mar, 5=mer, 6=gio, 7=ven,
  // 8=sab(WE), 9=dom(WE), 10=lun, 11=mar, 12=mer, 13=gio, 14=ven,
  // 15=sab(WE), 16=dom(WE), 17=lun, 18=mar, 19=mer, 20=gio, 21=ven,
  // 22=sab(WE), 23=dom(WE), 24=lun, 25=mar, 26=mer, 27=gio, 28=ven
  // WE: 1,2,8,9,15,16,22,23 = 8 giorni; FS non-WE: 0
  // Lavorativi = 28 - 8 = 20; con override 3 feb → Ferie: 19
  assert.equal(feb.worked, 19);
  assert.equal(feb.half, 0);
});

test('monthlyWorkStats ritorna sempre 12 elementi ordinati per mese', () => {
  const stats = monthlyWorkStats(2025, new Map());
  assert.equal(stats.length, 12);
  for (let i = 0; i < 12; i++) {
    assert.equal(stats[i]!.month, i + 1);
  }
});

test('override su weekend non cambia worked/half (WE non è lavorativo)', () => {
  // 4 gen 2025 = sabato (WE): un override 'WE'→'8' aggiungerebbe +1 worked
  // Un override 'WE'→'F' non cambia nulla (già non-lavorativo)
  const overrides = new Map<string, string>([
    ['1-4', 'F'],  // sab → Ferie (ma era già WE, effetto: ora è 'F', non '8' né 'M')
  ]);
  const stats = monthlyWorkStats(2025, overrides);
  const gen = stats[0]!;
  // Il sabato 4 gen con override 'F' → effectiveCode='F', non '8' → worked invariato
  assert.equal(gen.worked, 21);
  assert.equal(gen.half, 0);
});

test('override "WE"→"8" aggiunge 1 worked (recupero sabato)', () => {
  // Se si lavora un sabato, override → '8'
  const overrides = new Map<string, string>([
    ['1-4', '8'],  // sab 4 gen → lavoro straordinario
  ]);
  const stats = monthlyWorkStats(2025, overrides);
  const gen = stats[0]!;
  assert.equal(gen.worked, 22); // 21 + 1
  assert.equal(gen.half, 0);
});

test('Marzo 2025: 21 giorni lavorativi senza override', () => {
  // Marzo 2025: nessuna festività
  // 1=sab(WE),2=dom(WE),3=lun,4=mar,5=mer,6=gio,7=ven,
  // 8=sab(WE),9=dom(WE),10=lun,11=mar,12=mer,13=gio,14=ven,
  // 15=sab(WE),16=dom(WE),17=lun,18=mar,19=mer,20=gio,21=ven,
  // 22=sab(WE),23=dom(WE),24=lun,25=mar,26=mer,27=gio,28=ven,
  // 29=sab(WE),30=dom(WE),31=lun
  // WE: 1,2,8,9,15,16,22,23,29,30 = 10 giorni; FS: 0
  // Lavorativi = 31 - 10 = 21
  const stats = monthlyWorkStats(2025, new Map());
  const mar = stats[2]!;
  assert.equal(mar.month, 3);
  assert.equal(mar.worked, 21);
  assert.equal(mar.half, 0);
});

test('Aprile 2025: Pasqua + Pasquetta + 25 Aprile riducono lavorativi', () => {
  // Aprile 2025:
  // 1=mar, 2=mer, 3=gio, 4=ven, 5=sab(WE), 6=dom(WE),
  // 7=lun, 8=mar, 9=mer, 10=gio, 11=ven, 12=sab(WE), 13=dom(WE),
  // 14=lun, 15=mar, 16=mer, 17=gio, 18=ven, 19=sab(WE), 20=dom(Pasqua→WE),
  // 21=lun(Pasquetta→FS), 22=mar, 23=mer, 24=gio, 25=ven(Liberazione→FS),
  // 26=sab(WE), 27=dom(WE), 28=lun, 29=mar, 30=mer
  // WE: 5,6,12,13,19,20,26,27 = 8 giorni (Pasqua 20 apr = domenica → WE)
  // FS non-WE: 21(Pasquetta), 25(Liberazione) = 2 giorni
  // Lavorativi = 30 - 8 - 2 = 20
  const stats = monthlyWorkStats(2025, new Map());
  const apr = stats[3]!;
  assert.equal(apr.month, 4);
  assert.equal(apr.worked, 20);
  assert.equal(apr.half, 0);
});
