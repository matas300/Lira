// src/shared/fattura-xml.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  xmlEscape, fmtXmlNum, parseMaybeNumber, sanitizeXmlLatin1,
  sanitizeProgressivoInvio, modalitaToCodiceMP, regimeToRF, buildAnagraficaCessionario,
} from './fattura-xml';

test('xmlEscape — entità XML (apostrofo come &apos;)', () => {
  assert.equal(xmlEscape(`A & B <x> "q" 'z'`), 'A &amp; B &lt;x&gt; &quot;q&quot; &apos;z&apos;');
  assert.equal(xmlEscape(null), '');
});

test('fmtXmlNum — 2 decimali', () => {
  assert.equal(fmtXmlNum(1000), '1000.00');
  assert.equal(fmtXmlNum(10.005), '10.01');
  assert.equal(fmtXmlNum('x' as unknown as number), '0.00');
});

test('parseMaybeNumber — virgola decimale e fallback 0', () => {
  assert.equal(parseMaybeNumber('1,5'), 1.5);
  assert.equal(parseMaybeNumber(''), 0);
  assert.equal(parseMaybeNumber(3), 3);
});

test('sanitizeXmlLatin1 — smart quotes/euro/strip fuori Latin-1', () => {
  assert.equal(sanitizeXmlLatin1('“ciao”'), '"ciao"');
  assert.equal(sanitizeXmlLatin1('10€'), '10EUR');
  assert.equal(sanitizeXmlLatin1('café'), 'café');
  assert.equal(sanitizeXmlLatin1('A中B'), 'AB');
});

test('sanitizeProgressivoInvio — <=10 alfanumerici', () => {
  assert.equal(sanitizeProgressivoInvio('2026/1'), '20261');
  assert.equal(sanitizeProgressivoInvio(''), '00001');
  assert.equal(sanitizeProgressivoInvio('ABCDEFGHIJKLMNO'), 'ABCDEFGHIJ');
});

test('modalitaToCodiceMP — mappa + default bonifico', () => {
  assert.equal(modalitaToCodiceMP('Bonifico bancario'), 'MP05');
  assert.equal(modalitaToCodiceMP('contanti'), 'MP10');
  assert.equal(modalitaToCodiceMP(null), 'MP05');
});

test('regimeToRF — RF19 forfettario / RF01 ordinario', () => {
  assert.equal(regimeToRF('forfettario'), 'RF19');
  assert.equal(regimeToRF('ordinario'), 'RF01');
  assert.equal(regimeToRF('boh'), 'RF19');
});

test('buildAnagraficaCessionario — Denominazione da nome, sanitize+escape', () => {
  assert.equal(buildAnagraficaCessionario({ nome: 'ACME & Co' }), '<Denominazione>ACME &amp; Co</Denominazione>');
  assert.equal(buildAnagraficaCessionario({ nome: '' }), '<Denominazione></Denominazione>');
});

// ───── validateFatturaForXml (Task 3) ─────
import { validateFatturaForXml, type FatturaXmlInput } from './fattura-xml';

const cedenteX = {
  partitaIva: '00743110157', codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi',
  indirizzo: 'Via Roma 1', cap: '20100', comune: 'Milano', provincia: 'MI', nazione: 'IT',
  regime: 'forfettario' as const,
};
const clienteIT = {
  nome: 'ACME Srl', tipoCliente: 'PG', partitaIva: '00743110157', codiceFiscale: null,
  codiceSdi: '0000000', pec: null, indirizzo: 'Via Po 2', cap: '10100', citta: 'Torino',
  provincia: 'TO', nazione: 'IT',
};
function inputBase(): FatturaXmlInput {
  return {
    cedente: cedenteX, cliente: clienteIT, numero: '2026/1', data: '2026-03-01',
    righe: [{ descrizione: 'Consulenza', quantita: 1, prezzoUnitario: 1000 }],
    importo: 1000, ritenuta: 0, aliquotaRitenuta: null, tipoRitenuta: null, causaleRitenuta: null,
    marcaDaBollo: true, bolloAddebitato: false, modalitaPagamento: 'bonifico', contributoIntegrativo: 0,
  };
}

test('validateFatturaForXml — input valido -> nessun errore', () => {
  assert.deepEqual(validateFatturaForXml(inputBase()), []);
});

test('validateFatturaForXml — contributo integrativo > 0 -> errore (A3)', () => {
  const errs = validateFatturaForXml({ ...inputBase(), contributoIntegrativo: 50 });
  assert.ok(errs.some((e) => /integrativo/i.test(e)));
});

test('validateFatturaForXml — ritenuta in forfettario -> errore', () => {
  const errs = validateFatturaForXml({ ...inputBase(), ritenuta: 50 });
  assert.ok(errs.some((e) => /ritenuta/i.test(e)));
});

test('validateFatturaForXml — cliente IT senza P.IVA ne CF -> errore', () => {
  const errs = validateFatturaForXml({ ...inputBase(), cliente: { ...clienteIT, partitaIva: null, codiceFiscale: null } });
  assert.ok(errs.some((e) => /P\.IVA|Codice Fiscale/i.test(e)));
});

test('validateFatturaForXml — cliente PA con IPA non 6 char -> errore', () => {
  const errs = validateFatturaForXml({ ...inputBase(), cliente: { ...clienteIT, tipoCliente: 'PA', codiceSdi: '123' } });
  assert.ok(errs.some((e) => /IPA/i.test(e)));
});

test('validateFatturaForXml — sede cliente incompleta -> errore', () => {
  const errs = validateFatturaForXml({ ...inputBase(), cliente: { ...clienteIT, cap: '' } });
  assert.ok(errs.some((e) => /CAP/i.test(e)));
});
