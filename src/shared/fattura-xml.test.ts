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

test('validateFatturaForXml — regime ordinario -> fail-fast (export non supportato)', () => {
  const errs = validateFatturaForXml({ ...inputBase(), cedente: { ...cedenteX, regime: 'ordinario' as const } });
  assert.ok(errs.some((e) => /solo per il regime forfettario/i.test(e)));
});

test('validateFatturaForXml — cliente estero senza identificativo fiscale -> errore', () => {
  const errs = validateFatturaForXml({
    ...inputBase(),
    cliente: { ...clienteIT, tipoCliente: 'Estero', nazione: 'DE', partitaIva: null, codiceFiscale: null },
  });
  assert.ok(errs.some((e) => /estero senza identificativo/i.test(e)));
  // con VAT estera passa
  const ok = validateFatturaForXml({
    ...inputBase(),
    cliente: { ...clienteIT, tipoCliente: 'Estero', nazione: 'DE', partitaIva: 'DE123456789', codiceFiscale: null },
  });
  assert.deepEqual(ok, []);
});

// ───── buildFatturaXml (Task 4) ─────
import { buildFatturaXml } from './fattura-xml';

test('buildFatturaXml — struttura TD01 forfettario, N2.2, bollo, no ritenuta', () => {
  const xml = buildFatturaXml(inputBase());
  assert.match(xml, /versione="FPR12"/);
  assert.match(xml, /<TipoDocumento>TD01<\/TipoDocumento>/);
  assert.match(xml, /<RegimeFiscale>RF19<\/RegimeFiscale>/);
  assert.match(xml, /<Numero>2026\/1<\/Numero>/);
  assert.match(xml, /<Natura>N2\.2<\/Natura>/);
  assert.match(xml, /<DatiBollo>\s*<BolloVirtuale>SI<\/BolloVirtuale>\s*<ImportoBollo>2\.00<\/ImportoBollo>/);
  assert.ok(!/<DatiRitenuta>/.test(xml));
  assert.match(xml, /<ImponibileImporto>1000\.00<\/ImponibileImporto>/);
  assert.match(xml, /<CodiceDestinatario>0000000<\/CodiceDestinatario>/);
});

test('buildFatturaXml — ordine elementi DatiGeneraliDocumento', () => {
  const xml = buildFatturaXml(inputBase());
  const iTipo = xml.indexOf('<TipoDocumento>');
  const iDivisa = xml.indexOf('<Divisa>');
  const iData = xml.indexOf('<Data>');
  const iNumero = xml.indexOf('<Numero>');
  const iTot = xml.indexOf('<ImportoTotaleDocumento>');
  assert.ok(iTipo < iDivisa && iDivisa < iData && iData < iNumero && iNumero < iTot, 'ordine elementi errato');
});

test('buildFatturaXml — cedente IdTrasmittente usa CF per persona fisica', () => {
  const xml = buildFatturaXml(inputBase());
  assert.match(xml, /<IdTrasmittente>\s*<IdPaese>IT<\/IdPaese>\s*<IdCodice>RSSMRA80A01H501U<\/IdCodice>/);
});

test('buildFatturaXml — cliente PA: FPA12 (versione + FormatoTrasmissione) e IPA 6; estero senza DatiPagamento', () => {
  // Audit C1: PA con FormatoTrasmissione FPR12 → scarto SdI 00427.
  const pa = buildFatturaXml({ ...inputBase(), cliente: { ...inputBase().cliente, tipoCliente: 'PA', codiceSdi: 'UF1234' } });
  assert.match(pa, /<CodiceDestinatario>UF1234<\/CodiceDestinatario>/);
  assert.match(pa, /versione="FPA12"/);
  assert.match(pa, /<FormatoTrasmissione>FPA12<\/FormatoTrasmissione>/);
  assert.ok(!/FPR12/.test(pa), 'XML PA non deve contenere FPR12');

  const estero = buildFatturaXml({
    ...inputBase(),
    cliente: { nome: 'Foreign Co', tipoCliente: 'Estero', partitaIva: 'DE123', codiceFiscale: null,
      codiceSdi: '', pec: null, indirizzo: 'Strasse 1', cap: 'SW1A 1AA', citta: 'Berlin', provincia: '', nazione: 'DE' },
  });
  assert.match(estero, /<CodiceDestinatario>XXXXXXX<\/CodiceDestinatario>/);
  assert.match(estero, /<Nazione>DE<\/Nazione>/);
  // CAP estero non numerico → '00000' fisso (CAPType [0-9]{5}), niente mutilazioni tipo '00011'.
  assert.match(estero, /<CAP>00000<\/CAP>/);
  assert.ok(!/<DatiPagamento>/.test(estero));
});

test('buildFatturaXml — privato non-PA resta FPR12', () => {
  const xml = buildFatturaXml(inputBase());
  assert.match(xml, /versione="FPR12"/);
  assert.match(xml, /<FormatoTrasmissione>FPR12<\/FormatoTrasmissione>/);
});

test('buildFatturaXml — PECDestinatario emesso con SDI 0000000 e pec presente', () => {
  const conPec = buildFatturaXml({ ...inputBase(), cliente: { ...inputBase().cliente, pec: 'acme@pec.it' } });
  assert.match(conPec, /<CodiceDestinatario>0000000<\/CodiceDestinatario>\s*<PECDestinatario>acme@pec\.it<\/PECDestinatario>/);
  // con codice SDI reale niente PECDestinatario
  const conSdi = buildFatturaXml({ ...inputBase(), cliente: { ...inputBase().cliente, pec: 'acme@pec.it', codiceSdi: 'ABC1234' } });
  assert.ok(!/<PECDestinatario>/.test(conSdi));
  // senza pec niente PECDestinatario (golden invariato)
  assert.ok(!/<PECDestinatario>/.test(buildFatturaXml(inputBase())));
});

test('buildFatturaXml — rimborso bollo addebitato -> riga + DatiRiepilogo N1', () => {
  const xml = buildFatturaXml({ ...inputBase(), bolloAddebitato: true });
  assert.match(xml, /<Descrizione>Rimborso imposta di bollo<\/Descrizione>/);
  assert.match(xml, /<Natura>N1<\/Natura>/);
});

// ───── TD04 (Slice 5C) ─────

test('buildFatturaXml — TD04: importi POSITIVI (Guida AdE) + DatiFattureCollegate', () => {
  // La variazione è qualificata dal TipoDocumento TD04, non dal segno degli
  // importi: la Guida AdE alla compilazione vuole importi positivi.
  const xml = buildFatturaXml({
    ...inputBase(),
    tipoDocumento: 'TD04',
    fatturaOriginale: { numero: '2026/1', data: '2026-03-01' },
    marcaDaBollo: false,
  });
  assert.match(xml, /<TipoDocumento>TD04<\/TipoDocumento>/);
  assert.match(xml, /<PrezzoTotale>1000\.00<\/PrezzoTotale>/);
  assert.match(xml, /<ImponibileImporto>1000\.00<\/ImponibileImporto>/);
  assert.match(xml, /<ImportoTotaleDocumento>1000\.00<\/ImportoTotaleDocumento>/);
  assert.ok(!/-1000\.00/.test(xml), 'TD04 non deve contenere importi negativi');
  assert.match(xml, /<DatiFattureCollegate>\s*<RiferimentoNumeroLinea>1<\/RiferimentoNumeroLinea>\s*<IdDocumento>2026\/1<\/IdDocumento>\s*<Data>2026-03-01<\/Data>\s*<\/DatiFattureCollegate>/);
  assert.ok(!/<DatiBollo>/.test(xml));
});

test('buildFatturaXml — TD04: mai DatiBollo né rimborso bollo anche con flag attivi', () => {
  const xml = buildFatturaXml({
    ...inputBase(),
    tipoDocumento: 'TD04',
    fatturaOriginale: { numero: '2026/1', data: '2026-03-01' },
    marcaDaBollo: true, bolloAddebitato: true,
  });
  assert.ok(!/<DatiBollo>/.test(xml));
  assert.ok(!/Rimborso imposta di bollo/.test(xml));
});

test('buildFatturaXml — TD04: DatiFattureCollegate dopo DatiGeneraliDocumento (ordine XSD)', () => {
  const xml = buildFatturaXml({
    ...inputBase(), tipoDocumento: 'TD04',
    fatturaOriginale: { numero: '2026/1', data: '2026-03-01' }, marcaDaBollo: false,
  });
  assert.ok(xml.indexOf('</DatiGeneraliDocumento>') < xml.indexOf('<DatiFattureCollegate>'), 'DatiFattureCollegate deve seguire DatiGeneraliDocumento');
});

test('buildFatturaXml — TD01 invariato (default tipoDocumento)', () => {
  const xml = buildFatturaXml(inputBase());
  assert.match(xml, /<TipoDocumento>TD01<\/TipoDocumento>/);
  assert.match(xml, /<ImponibileImporto>1000\.00<\/ImponibileImporto>/);
  assert.ok(!/<DatiFattureCollegate>/.test(xml));
});

// ───── Golden XML di regressione (Task review 5B) ─────
// Confronto byte-a-byte con un riferimento conforme: difesa contro riordini
// accidentali degli elementi (scarto SdI 00400). CRLF normalizzato a LF perché
// git può convertire il .xml su Windows (autocrlf).
import { readFileSync } from 'node:fs';

test('GOLDEN — XML TD01 forfettario byte-identico al riferimento', () => {
  const golden = readFileSync(new URL('./__fixtures__/fattura-golden.xml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const goldenInput: FatturaXmlInput = {
    cedente: {
      partitaIva: '00743110157', codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi',
      indirizzo: 'Via Roma 1', cap: '20100', comune: 'Milano', provincia: 'MI', nazione: 'IT',
      regime: 'forfettario',
    },
    cliente: {
      nome: 'ACME Srl', tipoCliente: 'PG', partitaIva: '00743110157', codiceFiscale: null,
      codiceSdi: '0000000', pec: null, indirizzo: 'Via Po 2', cap: '10100', citta: 'Torino',
      provincia: 'TO', nazione: 'IT',
    },
    numero: '2026/1', data: '2026-03-01',
    righe: [{ descrizione: 'Consulenza informatica', quantita: 2, prezzoUnitario: 500 }],
    importo: 1000, ritenuta: 0, aliquotaRitenuta: null, tipoRitenuta: null, causaleRitenuta: null,
    marcaDaBollo: true, bolloAddebitato: false, modalitaPagamento: 'bonifico', contributoIntegrativo: 0,
  };
  assert.equal(buildFatturaXml(goldenInput), golden);
});

// Fixture rigenerata (audit FatturaPA 2026-06): importi TD04 ora POSITIVI come
// da Guida AdE — il segno non qualifica la variazione, lo fa il TipoDocumento.
test('GOLDEN — XML TD04 byte-identico al riferimento (importi positivi)', () => {
  const golden = readFileSync(new URL('./__fixtures__/nota-credito-golden.xml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const input: FatturaXmlInput = {
    cedente: { partitaIva: '00743110157', codiceFiscale: 'RSSMRA80A01H501U', nome: 'Mario', cognome: 'Rossi',
      indirizzo: 'Via Roma 1', cap: '20100', comune: 'Milano', provincia: 'MI', nazione: 'IT', regime: 'forfettario' },
    cliente: { nome: 'ACME Srl', tipoCliente: 'PG', partitaIva: '00743110157', codiceFiscale: null,
      codiceSdi: '0000000', pec: null, indirizzo: 'Via Po 2', cap: '10100', citta: 'Torino', provincia: 'TO', nazione: 'IT' },
    numero: '2026/2', data: '2026-04-01',
    righe: [{ descrizione: 'Storno consulenza informatica', quantita: 2, prezzoUnitario: 500 }],
    importo: 1000, ritenuta: 0, aliquotaRitenuta: null, tipoRitenuta: null, causaleRitenuta: null,
    marcaDaBollo: false, bolloAddebitato: false, modalitaPagamento: 'bonifico', contributoIntegrativo: 0,
    tipoDocumento: 'TD04', fatturaOriginale: { numero: '2026/1', data: '2026-03-01' },
  };
  assert.equal(buildFatturaXml(input), golden);
});
