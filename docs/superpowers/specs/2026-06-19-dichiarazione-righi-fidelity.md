# Dichiarazione — Fedeltà righi LM/RX al modello Redditi PF (#2 #3 #4)

Slice che risolve i 3 rilievi fiscali emersi dall'audit 6C, verificati sulle
istruzioni AdE del quadro LM Sezione III (regime forfettario).

## #2 — Rinumerazione righi LM/RX (modello Redditi PF, Sez. III quadro LM)

Mappatura corretta (fonti: fiscomania, informazionefiscale, Sole24Ore Esperto Risponde):

| Rigo | Significato | Valore (motore) |
|---|---|---|
| LM22 | Componenti positivi (ricavi/compensi percepiti) | `grossCollected` |
| LM34 | Reddito lordo (ricavi × coefficiente) | `forfettarioGrossIncome` |
| LM35 | Contributi previdenziali e assistenziali deducibili | `deductibleContributionsPaid` |
| LM36 | Reddito netto (LM34 − LM35) | `lm36` |
| LM38 | Reddito al netto delle perdite (imponibile) | `taxableBase` |
| LM39 | Imposta sostitutiva (15%/5% di LM38) | `applied.imposta` |
| LM40 | Crediti d'imposta | `applied.creditiImposta` |
| LM41 | Ritenute (forfettario art.1 c.67 = 0) | 0 |
| LM43 | Eccedenza d'imposta dalla dichiarazione precedente | `applied.creditoAnnoPrec` |
| LM45 | Acconti versati | `applied.accontiVersati` |
| LM46 | Imposta sostitutiva a debito (saldo) → RX31 col.1 | `applied.saldoEffettivo` |
| LM47 | Imposta sostitutiva a credito → RX31 col.5 | `applied.creditoDaRiportare` |

Quadro RX: il rigo per l'imposta sostitutiva forfettario è **RX31** (non RX1/RX4):
- RX31 col.1 (debito) = LM46 = `saldoEffettivo`
- RX31 col.5 (credito da riportare/compensare) = LM47 = `creditoDaRiportare`

Il **credito anno precedente** si sposta da RX1 → **LM43** (è l'eccedenza della
dichiarazione precedente, = col.5 RX31 dell'anno prima).

## #3 — Arrotondamento all'unità di euro

Le istruzioni AdE arrotondano i righi del modello all'unità di euro. Il motore
arrotonda a euro (`r0 = Math.round`) le grandezze dell'imposta sostitutiva dentro
`applyDichiarazioneOverrides` (imposta/acconti/crediti/credito-prec/saldo/credito)
e i righi LM/RX scenario-derivati. Così LM39-47, RX31 e il tributo F24 1792 sono
coerenti e in euro. INPS (quadro RR, righe INPS F24) e acconti N+1 (1790/1791)
restano invariati: sono dominio del tax-engine/scadenziario, fuori scope #3.

## #4 — Acconti versati stimati (rischio doppio pagamento)

Il default di LM45 deriva dai pagamenti tracciati (`substituteTax − taxSaldo`), una
stima, non gli F24 effettivamente versati. Mitigazione: warning info
`DICH_ACCONTI_STIMATI` quando l'acconto è valorizzato e NON è override-ato, per
invitare alla verifica. Il knob di override (6C) resta la correzione.

## Invariante di non-regressione
Con override ai default e valori in euro interi (fixture sintetiche), i numeri
restano identici a 6A/6B/6C. Cambiano solo le CHIAVI dei righi (LM/RX) e si
aggiunge il warning acconti-stimati.
