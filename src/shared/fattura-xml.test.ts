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
