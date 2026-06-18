# Dichiarazione 6B — Modelli F24 (read-only)

**Data:** 2026-06-18
**Slice:** 6B (follow-up di Dichiarazione 6A)
**Stato:** design approvato, pronto per writing-plans

## Obiettivo

Estendere la pagina `/dichiarazione` con un blocco **read-only "Modelli F24"** che proietta gli
importi già calcolati (imposta sostitutiva + contributi INPS variabili, saldo + acconti) nei
**codici tributo / causali e sezioni** del modello F24, raggruppati per data di scadenza.

È un **prospetto di calcolo**, non un modello F24 telematico compilabile/trasmissibile: sede e
matricola INPS, codice Atecofin e il file CBI/telematico sono **fuori scope** (vedi sotto).

## Mappa temporale (cuore del 6B)

La dichiarazione copre l'**anno d'imposta N**; è presentata e versata in **N+1**. L'F24 che ne
nasce contiene **saldo di N + acconti su N+1** (regole non negoziabili skill
`dichiarazione-forfettario`: anno d'imposta ≠ anno versamento, imposta ≠ INPS, no doppio
conteggio acconti).

| Scadenza | Sezione | Codice/Causale | Anno rif. | Importo (fonte) |
|---|---|---|---|---|
| **30/06/N+1**¹ | Erario | `1792` saldo sostitutiva | **N** | `scenario(N).taxSaldo` (= LM45) |
| | Erario | `1790` acconto 1ª rata | **N+1** | acconto₁ ricalcolato su `substituteTax(N)` |
| | INPS | `AP`/`CP`/`P10`² saldo variabili | **N** | `scenario(N).contributionSaldo` |
| | INPS | `AP`/`CP`/`P10` acconto 1 | **N+1** | acconto₁ ricalcolato su `contributiVariabiliDovuti(N)` |
| **30/11/N+1** | Erario | `1791` acconto 2ª rata | **N+1** | acconto₂ ricalcolato su `substituteTax(N)` |
| | INPS | `AP`/`CP`/`P10` acconto 2 | **N+1** | acconto₂ ricalcolato su `contributiVariabiliDovuti(N)` |

¹ con proroga/rolling riusando `@shared/date-rules` (`buildRolledDueDate`); la proroga
(`ys.prorogaSaldoAt`) colpisce **solo** il 30/06, mai il 30/11 — coerente con
`scadenziario-engine.ts` (famiglie `imposta_saldo`/`imposta_acc1`/`contributi_saldo`/`contributi_acc1`).
² `AP` artigiani / `CP` commercianti / `P10` gestione separata professionisti.

### Punto fiscale chiave: gli acconti vanno RICALCOLATI

Gli acconti sull'F24 NON sono `scenario(N).taxAcconti`: quelli sono gli acconti **su N**
(base = imposta N-1), già imputati in LM43 e versati durante N. L'F24 da dichiarazione di N
contiene gli acconti **su N+1**, la cui base è l'**imposta di N** (`substituteTax(N)` per
l'Erario, `contributiVariabiliDovuti(N)` per l'INPS), con le regole acconto:

- imposta `< 51,65 €` → nessun acconto;
- `51,65 ≤ imposta < 257,52 €` → acconto unico a novembre (1ª rata = 0);
- `≥ 257,52 €` → split **50/50** (forfettari inclusi, art. 58 DL 124/2019).

Queste regole vivono già nel tax-engine (`buildAccontoPlan`, `buildContributiAccontoPlan`):
il motore F24 le **riusa** (single source of logic), non le riscrive.

Righe a importo `0` (es. acconto sotto soglia, oppure saldo già coperto dagli acconti) vengono
**omesse** dal modulo.

## Approccio scelto

**A — Ricalcolo inline nel motore F24.** Il builder F24 calcola gli acconti su N+1 chiamando gli
helper esistenti del tax-engine sui dati di `scenario(N)`. Il motore dichiarazione resta
autosufficiente (input: `scenario(N)` + `ys`), nessun fetch extra, nessuna duplicazione della
logica acconto.

Alternative scartate:
- **B — caricare `scenario(N+1)`** e leggerne `.taxAcconti`: più pesante e concettualmente storto
  ("carico N+1 per dichiarare N").
- **C — specchio dei righi** (`scenario(N).taxAcconti` così com'è): **fiscalmente errato**, mette
  acconti su N (anno sbagliato) accanto al saldo di N.

## Struttura tecnica

### Motore — `src/server/lib/dichiarazione-engine.ts`

Tipi nuovi:

```ts
export type F24Sezione = 'erario' | 'inps';
export interface F24Riga {
  sezione: F24Sezione;
  codice: string;        // '1792' | '1790' | '1791' | 'AP' | 'CP' | 'P10'
  descrizione: string;
  annoRiferimento: number;
  importo: number;       // > 0 (righe a 0 omesse)
}
export interface F24Modulo {
  scadenza: string;      // ISO date (post proroga/rolling)
  scadenzaOriginale: string;
  prorogaApplied: boolean;
  righe: F24Riga[];
  totale: number;
}
```

`Dichiarazione` guadagna il campo `f24: F24Modulo[]`.

Funzione pura nuova:

```ts
export function buildF24(s: ForfettarioScenario, ys: DichiarazioneYsView, year: number): F24Modulo[]
```

- ricalcola acconti N+1 via `buildAccontoPlan(s.substituteTax, rules)` e
  `buildContributiAccontoPlan(s.contributiVariabiliDovuti, ys.inpsMode, …)`;
- mappa codici via una costante `F24_CODICI` (Erario sostitutiva: saldo `1792`, acc1 `1790`,
  acc2 `1791`; INPS causale derivata da `inpsMode`+`inpsCategoria`: `AP`/`CP`/`P10`);
- calcola le due date con `buildRolledDueDate` + regola proroga (solo 30/06);
- omette righe `importo === 0`; un modulo senza righe non viene emesso;
- `buildDichiarazione` chiama `buildF24` e popola `f24`.

`DichiarazioneYsView` esteso con i campi necessari:

```ts
export interface DichiarazioneYsView {
  regime: string;
  inpsMode: string;
  inpsCategoria: string | null;   // NUOVO — per causale AP vs CP
  impostaSostitutiva: number;
  coefficiente: number;
  limiteForfettario: number;
  prorogaSaldoAt: string | null;  // NUOVO — per data 30/06
}
```

### Endpoint — `src/server/routes/dichiarazione.ts`

Nessun route nuovo, nessuna migration. L'handler popola i due campi `ys` aggiunti
(`inpsCategoria`, `prorogaSaldoAt`) dai year-settings già letti. Output JSON guadagna `f24`.

### Frontend — `src/client/pages/dichiarazione.ts`

Blocco read-only **"Modelli F24"** sotto i quadri LM/RR:
- una card per modulo (30/06/N+1, 30/11/N+1) con data scadenza (badge proroga se applicata);
- tabella per sezione (Erario, INPS): codice/causale, descrizione, anno rif., importo;
- totale per modulo;
- nota fissa: l'anno di riferimento del saldo è N, degli acconti N+1; il prospetto non include
  sede/matricola INPS (non compilabile per la trasmissione).
- se `f24` è vuoto (es. regime non forfettario, o tutto sotto soglia) → messaggio neutro.

### Warning (in `buildWarnings`)

- `F24_ACCONTI_SOTTO_SOGLIA` (info): un acconto è 0 perché l'imposta non supera 51,65 €.
- `F24_INPS_SEDE_MANCANTE` (info): prospetto di calcolo, sede/matricola INPS non disponibili.

(Il warning `REGIME_NON_FORFETTARIO` esistente già copre il caso "niente F24".)

## Test (`dichiarazione-engine.test.ts`)

- **Golden Mattia 2025** e **Peru 2025**: importi F24 bloccati (calcolo manuale dei 2 moduli).
- Soglie acconto: imposta `< 51,65` (nessun acconto), banda unico-novembre (acc1=0, acc2 pieno),
  `≥ 257,52` (split 50/50).
- Proroga: `prorogaSaldoAt` valorizzato → 30/06 spostato, 30/11 invariato, `prorogaApplied=true`.
- Rolling: 30/06 o 30/11 che cade di weekend → data shiftata.
- Rami INPS: artigiani (`AP`), commercianti (`CP`), gestione separata (`P10`).
- Regime non forfettario → `f24: []`.
- Righe a 0 omesse; moduli vuoti non emessi.

## Fuori scope (espliciti)

- INPS fissi, bollo, diritto camerale → restano nello **Scadenziario** (scelta scope).
- Sede/matricola INPS, codice Atecofin, file F24 telematico/CBI o PDF stampabile.
- Override manuali degli importi → **6C**.
- Acconto con metodo previsionale per l'F24 (si usa lo storico/consuntivo, coerente con 6A che
  usa `scenario.historical`).

## Note di coerenza

- Il motore dichiarazione resta **puro** e self-contained (solo `scenario` + `ys`).
- Single source of logic: gli acconti riusano gli helper del tax-engine, non li riscrivono.
- Nessun doppio conteggio: il saldo (`taxSaldo`/`contributionSaldo`) è già al netto degli acconti
  versati durante N (FIX A6); gli acconti F24 sono quelli **su N+1**, base imposta N.
