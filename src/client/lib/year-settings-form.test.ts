import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, stateFromResponse, bodyFromState, atecoOptions, selectedAtecoIndex } from './year-settings-form';

test('defaults: forfettario, 78%, 15%, gestione separata, limite 85000', () => {
  const d = defaults();
  assert.equal(d.regime, 'forfettario');
  assert.equal(d.coefficiente, 0.78);
  assert.equal(d.impostaSostitutiva, 0.15);
  assert.equal(d.inpsMode, 'gestione_separata');
  assert.equal(d.inpsCategoria, null);
  assert.equal(d.limiteForfettario, 85000);
  assert.equal(d.scadenziarioMetodo, 'storico');
  assert.equal(d.riduzione35, false);
});

test('stateFromResponse: converte i flag 0/1 del server in boolean', () => {
  const s = stateFromResponse({
    regime: 'forfettario', coefficiente: 0.67, impostaSostitutiva: 0.05,
    inpsMode: 'artigiani_commercianti', inpsCategoria: 'artigiano',
    riduzione35: 1, riduzione35Comunicata: 1, riduzione35DataComunicazione: '2026-02-20',
    haRedditoDipendente: 0, limiteForfettario: 85000, scadenziarioMetodo: 'previsionale',
    prorogaSaldoAt: null, tariffaGiornaliera: 250,
    primoAnnoFatturatoPrec: null, primoAnnoImpostaPrec: null, primoAnnoAccontiImpostaPrec: null,
    primoAnnoContribVariabiliPrec: null, primoAnnoAccontiContribPrec: null,
  });
  assert.equal(s.riduzione35, true);
  assert.equal(s.riduzione35Comunicata, true);
  assert.equal(s.haRedditoDipendente, false);
  assert.equal(s.inpsCategoria, 'artigiano');
  assert.equal(s.tariffaGiornaliera, 250);
});

test('bodyFromState: boolean → 0/1; inpsCategoria null se gestione separata', () => {
  const s = { ...defaults(), inpsMode: 'gestione_separata' as const, inpsCategoria: 'artigiano' as const, haRedditoDipendente: true };
  const b = bodyFromState(s);
  assert.equal(b.haRedditoDipendente, 1);
  assert.equal(b.inpsCategoria, null);
  assert.equal(b.regime, 'forfettario');
});

test('bodyFromState: riduzione disattiva → comunicata 0 e data null', () => {
  const s = { ...defaults(), riduzione35: false, riduzione35Comunicata: true, riduzione35DataComunicazione: '2026-02-01' };
  const b = bodyFromState(s);
  assert.equal(b.riduzione35, 0);
  assert.equal(b.riduzione35Comunicata, 0);
  assert.equal(b.riduzione35DataComunicazione, null);
});

test('atecoOptions / selectedAtecoIndex: pre-seleziona il primo gruppo col coefficiente dato', () => {
  const opts = atecoOptions();
  assert.ok(opts.length >= 6);
  const idx = selectedAtecoIndex(0.78, opts);
  assert.ok(idx >= 0);
  assert.equal(opts[idx]!.coefficiente, 0.78);
  assert.equal(selectedAtecoIndex(0.99, opts), -1);
});
