// Export CalcoliVari sintetico (formato ufficiale) che copre tutte le 9 entità,
// incl. insidie: pagamento cross-year, fattura legacy in _fattureManualeWipedBackup,
// lmQuadro legacy, calendar sparso. Congelato come golden anchor per regression.

export const OFFICIAL_SAMPLE: Record<string, unknown> = {
  'calcoliPIVA_Mattia_2024': {
    settings: {
      regime: 'forfettario', coefficiente: 67, impostaSostitutiva: 5, inpsMode: 'gestione_separata',
      limiteForfettario: 85000, scadenziarioMetodoAcconti: 'storico',
      anagrafica: { nome: 'Mattia', codiceFiscale: 'RSSMTT90A01H501X' }, attivita: { partitaIva: '12345678901', codiceAteco: '62.01.00' },
    },
    pagamenti: [{ data: '2024-06-30', tipo: 'tasse', descrizione: 'saldo 2023', importo: 500, scheduleKey: 'imposta_saldo_2023' }],
    budget: [{ nome: 'Tasse da accantonare', importo: 1000, auto: true }, { nome: 'Vacanza', importo: 800 }],
    spese: [{ titolo: 'Laptop', costo: 1200, deducibilita: 1, anni: 2 }],
    calendar: { '3-15': 'F', '8-10': 'M', '6-1': '' },
    lmQuadro: { overrides: { LM_perditePregresse: 300 } },
    _fattureManualeWipedBackup: { '5': [{ importo: 300, desc: 'Consulenza vecchia', pagMese: 5, pagAnno: 2024 }] },
  },
  'calcoliPIVA_Mattia_2025': {
    settings: {
      regime: 'forfettario', coefficiente: 67, impostaSostitutiva: 5, inpsMode: 'gestione_separata',
      limiteForfettario: 85000, anagrafica: { cognome: 'Rossi', residenzaComune: 'Milano' },
    },
    pagamenti: [
      { data: '2025-06-30', tipo: 'tasse', descrizione: 'acc1', importo: 900, scheduleKey: 'imposta_acc1_2025' },
      { data: '2025-08-20', tipo: 'contributi', descrizione: 'inps', importo: 1200, scheduleKey: 'contributi_acc1_2025' },
    ],
    dichiarazione: { tipoDichiarazione: 'ordinaria', flags: { annoMisto: false }, overrides: { LM_creditoImposta: 50 }, contiEsteri: [], statoCompilazione: 'bozza' },
  },
  'calcoliPIVA_Mattia_fattureEmesse': [
    { id: 'fat-1', annoProgressivo: 2025, progressivo: 7, numero: '7/2025', data: '2025-03-01', tipoDocumento: 'TD01', totaleLordo: 1500, righe: [{ descrizione: 'Sviluppo', quantita: 1, prezzoUnitario: 1500, iva: 0 }], stato: 'pagata', origine: 'wizard', clienteId: 'cli-1', pagMese: 4, pagAnno: 2025 },
  ],
  'calcoliPIVA_Mattia_clienti': [{ id: 'cli-1', nome: 'ACME Spa', tipoCliente: 'PG', partitaIva: '99988877766', codiceSDI: 'ABCDEF1' }],
  'calcoliPIVA_Mattia_clienteDefaultId': 'cli-1',
  'calcoliPIVA_Mattia_giorniIncasso': 45,
  'calcoliPIVA_profile_Mattia': { nome: 'Mattia', partitaIva: '12345678901', ateco: '62.01.00', iban: 'IT60X0542811101000000123456' },
};

// Variante backup-wrapper degli stessi dati (valori come stringhe).
export const WRAPPER_SAMPLE = {
  profile: 'Mattia',
  timestamp: '2026-05-25T10:00:00Z',
  keys: Object.fromEntries(Object.entries(OFFICIAL_SAMPLE).map(([k, v]) => [k, JSON.stringify(v)])),
};
