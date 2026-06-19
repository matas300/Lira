# Dichiarazione 6C — Rettifiche manuali (override LM + RX credito)

**Data:** 2026-06-18
**Slice:** 6C (follow-up di Dichiarazione 6A/6B)
**Stato:** design approvato, pronto per writing-plans

## Obiettivo

Aggiungere alla dichiarazione `/dichiarazione` un piccolo set di **rettifiche manuali** (override)
che modificano il saldo dell'imposta sostitutiva e la compensazione del credito da anno precedente.
Finora 6A/6B sono read-only (la dichiarazione mappa lo scenario = single source of truth); 6C
introduce input editabili **a valle** dello scenario, con il calcolato sempre visibile e un badge
"override" sui righi modificati.

## Scope (minimale, YAGNI)

Tre "knob" semantici, ciascuno con default = valore calcolato; impostarli a un valore esplicito
sovrascrive quel default:

| Knob (chiave) | Rigo | Default calcolato | Effetto |
|---|---|---|---|
| `accontiVersati` | LM43 | `substituteTax − taxSaldo` (acconti imputati dai pagamenti) | rettifica se il tracking pagamenti è impreciso |
| `creditiImposta` | LM39 | `0` | crediti d'imposta che riducono l'imposta prima del saldo |
| `creditoAnnoPrec` | RX1 | `0` | credito da anno precedente che compensa il saldo |

### Formula del saldo effettivo

Sostituisce il map diretto di 6A (`LM45 = scenario.taxSaldo`):

```
imposta            = scenario.substituteTax            (NON override-abile: derivato)
saldoEffettivo     = max(imposta − creditiImposta − accontiVersati − creditoAnnoPrec, 0)
creditoDaRiportare = max(creditiImposta + accontiVersati + creditoAnnoPrec − imposta, 0)   // RX4
```

**Invariante di non-regressione:** con tutti i knob ai default (`creditiImposta=0`,
`creditoAnnoPrec=0`, `accontiVersati = substituteTax − taxSaldo`), `saldoEffettivo === scenario.taxSaldo`
e `creditoDaRiportare === 0` → numeri identici a 6A.

### Coerenza con l'F24 (6B)

Gli override cambiano il saldo, quindi il **tributo Erario 1792 (saldo) dell'F24 deve usare
`saldoEffettivo`**, non `scenario.taxSaldo`. Gli acconti su N+1 dell'F24 restano basati su
`substituteTax(N)` (non toccati dagli override, che riguardano il saldo di N). Questo evita che
LM45 e l'F24 divergano.

## Dove vivono i dati

Nel campo `overrides` (JSON) di `year_settings` — **già esistente**, già round-trip in GET/PUT
year-settings con carry-over (`src/server/routes/year-settings.ts`). I 3 knob stanno sotto una
chiave namespaced `dichiarazione`, accanto agli override scadenziario già presenti:

```json
{ "scadenziarioSaldoImposta": 123, "dichiarazione": { "accontiVersati": 1200, "creditoAnnoPrec": 350 } }
```

Chiavi assenti o `null` → default calcolato. **Nessuna migration.**

## Architettura

### Motore — `src/server/lib/dichiarazione-engine.ts`

Tipi nuovi:

```ts
export interface DichiarazioneOverridesInput {
  accontiVersati?: number | null;
  creditiImposta?: number | null;
  creditoAnnoPrec?: number | null;
}
export interface DichiarazioneOverridesApplied {
  accontiVersati: number;   // effettivo (override o default imputato)
  creditiImposta: number;   // effettivo
  creditoAnnoPrec: number;  // effettivo
  imposta: number;          // scenario.substituteTax
  saldoEffettivo: number;   // LM45
  creditoDaRiportare: number; // RX4
  overridden: { accontiVersati: boolean; creditiImposta: boolean; creditoAnnoPrec: boolean };
}
```

Funzione pura nuova:

```ts
export function applyDichiarazioneOverrides(
  s: ForfettarioScenario, ov: DichiarazioneOverridesInput,
): DichiarazioneOverridesApplied
```

- `accontiVersati` default = `max(substituteTax − taxSaldo, 0)`; override se `ov.accontiVersati` è un numero finito ≥ 0.
- `creditiImposta`/`creditoAnnoPrec` default 0; override analogo.
- calcola `saldoEffettivo` e `creditoDaRiportare` con la formula sopra (rete a 2 decimali con `r2`).
- `overridden.*` true quando il knob è stato fornito.

Consumo:
- `buildQuadroLM(s, applied)` — LM36 imposta (computed), LM39 crediti (source `override` se overridden, else `zero`), LM43 acconti (source `override` se overridden), LM45 = `saldoEffettivo`.
- `buildQuadroRX(applied)` — RX1 = `creditoAnnoPrec` (source override se overridden), RX4 = `creditoDaRiportare`.
- `buildF24(s, ys, year, applied)` — il tributo 1792 usa `applied.saldoEffettivo` invece di `s.taxSaldo`. Acconti N+1 invariati.
- `buildDichiarazione(inp)` — calcola `applied` una volta, lo passa a LM/RX/F24; aggiunge warning `DICH_OVERRIDE_ATTIVO` (info) se almeno un knob è overridden.

`DichiarazioneInput` guadagna `overrides: DichiarazioneOverridesInput` (default `{}`).

**Compatibilità firme:** `buildQuadroLM`, `buildQuadroRX`, `buildF24` cambiano firma → aggiornare i test 6A/6B esistenti. Con `applied` ai default i loro assert restano validi (invariante di non-regressione).

### Endpoint — `src/server/routes/dichiarazione.ts`

- `GET /api/dichiarazione/:year`: legge `year_settings.overrides`, estrae `overrides.dichiarazione` (parse difensivo), lo passa a `buildDichiarazione`. Output JSON include i righi con `saldoEffettivo`/RX già applicati (il client non ricalcola).
- **Nuovo `PATCH /api/dichiarazione/:year`**: body Zod `{ accontiVersati?: number≥0|null, creditiImposta?: number≥0|null, creditoAnnoPrec?: number≥0|null }`. Merge non-distruttivo dentro `overrides.dichiarazione` (riusa il pattern di parse+merge del PUT year-settings, preservando gli altri override scadenziario). `null` su un campo lo rimuove (torna al default). Richiede year-settings esistenti (404 `YEAR_SETTINGS_NOT_FOUND` altrimenti). Risponde con la dichiarazione ricalcolata.

Validazione: numeri finiti ≥ 0; rifiuta NaN/Infinity/negativi con 422.

### Frontend — `src/client/pages/dichiarazione.ts`

- Nuovo blocco "Rettifiche manuali" (sotto i quadri, sopra o sotto l'F24): 3 input numerici
  (Acconti versati LM43, Crediti d'imposta LM39, Credito anno precedente RX1) con placeholder = valore
  calcolato di default, **Salva** e **Ripristina calcolato** (azzera i 3 → PATCH con `null`).
- I righi LM39/LM43/LM45/RX1/RX4 mostrano il valore effettivo; badge "override" via `sourceBadge`
  (source `override` — aggiungere il caso al renderer esistente, oggi gestisce `from-profile`/`zero`).
- Dopo Salva (PATCH) → re-render con la dichiarazione restituita; errori inline.
- Banner/warning `DICH_OVERRIDE_ATTIVO` nel blocco Controlli quando attivo.

## Error handling

- PATCH con anno non configurato → 404 `YEAR_SETTINGS_NOT_FOUND`.
- `overrides` JSON corrotto → parse difensivo, trattato come `{}` (come fa già year-settings).
- Valori non validi → 422 con messaggio per campo.
- Regime non forfettario: gli override non hanno effetto sul calcolo (la dichiarazione resta come 6A/6B); il blocco rettifiche può restare nascosto o disabilitato (scelta frontend, non bloccante).

## Test (`dichiarazione-engine.test.ts` + route)

- `applyDichiarazioneOverrides`: default → `saldoEffettivo === taxSaldo`, `creditoDaRiportare === 0`, tutti `overridden=false` (non-regressione).
- override acconti: saldo cambia di conseguenza.
- creditiImposta + creditoAnnoPrec riducono il saldo; eccedenza → `creditoDaRiportare` (RX4) e saldo a 0.
- clamp: somma crediti+acconti > imposta → saldo 0, RX4 = eccedenza.
- `overridden.*` flag corretti; `null`/assente → default.
- `buildQuadroLM`/`buildQuadroRX` con `applied`: LM45/RX1/RX4 corretti, source `override` solo dove overridden.
- `buildF24`: 1792 usa `saldoEffettivo` (override acconti che azzera il saldo → riga 1792 omessa perché importo 0).
- `buildDichiarazione`: warning `DICH_OVERRIDE_ATTIVO` presente sse almeno un knob overridden; assente ai default.
- test 6A/6B esistenti adattati alle nuove firme con `applied` di default → restano verdi.
- route PATCH (se esiste un pattern di route test; altrimenti coperto dal motore + verifica manuale):
  merge non-distruttivo con gli override scadenziario, `null` rimuove, 404 senza year-settings, 422 su input invalido.

## Fuori scope (espliciti)

- **Perdite pregresse** (art. 84 TUIR): un forfettario non genera perdite (reddito = ricavi × coeff ≥ 0);
  rilevanti solo se riportate da un precedente regime ordinario → YAGNI per i 3 utenti.
- **RS editabili** (dati informativi, non incidono sull'imposta).
- **Override grezzi** di LM1/LM2/LM3/LM4/LM34 (il fix corretto è correggere fatture/pagamenti).
- **Override del metodo previsionale** (la dichiarazione usa lo storico/consuntivo).

## Note di coerenza

- Single source of truth preservato: lo scenario resta il calcolato; gli override sono un layer
  esplicito e tracciato (badge + warning), applicato una volta sola e condiviso da LM/RX/F24.
- Nessuna migration: riuso del campo `overrides` JSON già esistente e già persistito.
- Non-regressione garantita dall'invariante "default = 6A".
