import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getInpsArtComForYear, getInpsGsForYear, INPS_ARTCOM, INPS_GS } from './inps-params';

test('INPS_ARTCOM 2025 contiene minimale, quota fissa, aliquota, massimale', () => {
  const p = INPS_ARTCOM[2025];
  assert.ok(p, '2025 deve esistere');
  assert.ok(p.minimaleAnnuo > 17000 && p.minimaleAnnuo < 20000, 'minimale 2025 nel range atteso');
  assert.ok(p.quotaFissaAnnuaArtigiano > 4000 && p.quotaFissaAnnuaArtigiano < 5000, 'quota fissa 2025 nel range atteso');
  assert.equal(p.aliquotaArtigiano, 0.24);
  assert.equal(p.aliquotaCommerciante, 0.2448);
  assert.ok(p.massimale > 100000);
});

test('INPS_GS 2025 contiene aliquote e massimale', () => {
  const p = INPS_GS[2025];
  assert.ok(p, '2025 deve esistere');
  assert.equal(p.aliquotaSenzaAltraCassa, 0.2607);
  assert.equal(p.aliquotaConAltraCassa, 0.24);
  assert.ok(p.massimale > 100000);
});

test('getInpsArtComForYear: anno mancante → throw con messaggio chiaro', () => {
  assert.throws(
    () => getInpsArtComForYear(1999),
    /INPS_ARTCOM.*1999/,
  );
});

test('getInpsArtComForYear: anno valido → params', () => {
  const p = getInpsArtComForYear(2025);
  assert.equal(typeof p.minimaleAnnuo, 'number');
});

test('INPS_ARTCOM 2025: quotaFissaAnnuaCommerciante > quotaFissaAnnuaArtigiano (surcharge L. 662/1996)', () => {
  const p = INPS_ARTCOM[2025];
  assert.ok(p);
  assert.ok(p.quotaFissaAnnuaCommerciante > p.quotaFissaAnnuaArtigiano, 'commerciante deve essere maggiore di artigiano');
  assert.ok(p.quotaFissaAnnuaCommerciante < 5000);
});

test('getInpsGsForYear: anno mancante → throw con messaggio chiaro', () => {
  assert.throws(
    () => getInpsGsForYear(1999),
    /INPS_GS.*1999/,
  );
});

test('getInpsGsForYear: anno valido → params', () => {
  const p = getInpsGsForYear(2025);
  assert.equal(typeof p.massimale, 'number');
});
