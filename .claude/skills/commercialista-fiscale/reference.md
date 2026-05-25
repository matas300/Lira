# Reference - Commercialista Fiscale

## Ruolo della skill
Questa skill è un motore di simulazione per richieste su Partita IVA, non un generatore di testo generico.

Deve essere usata quando l'utente vuole:
- simulare netto annuo o mensile;
- stimare imposte e contributi;
- confrontare forfettario e ordinario;
- verificare requisiti o soglie;
- capire se un certo fatturato è sostenibile o conveniente.

## Albero decisionale rapido
1. Identifica il regime richiesto:
   - forfettario
   - ordinario
   - confronto
2. Identifica il problema principale:
   - netto da fatturato
   - fatturato da netto desiderato
   - convenienza tra regimi
   - verifica accesso/permanenza
   - stima fiscale/previdenziale
3. Identifica il perimetro previdenziale:
   - Gestione Separata
   - Artigiani
   - Commercianti
   - altra cassa professionale
4. Identifica l'orizzonte temporale:
   - anno d'imposta
   - anno di pagamento
   - anno di confronto

## Parametri da raccogliere
## Core
- anno di riferimento
- ricavi/compensi
- regime
- ATECO
- coefficiente di redditività
- gestione previdenziale

## Avanzati
- contributi già versati
- riduzione contributiva
- aliquota start-up
- redditi da lavoro dipendente/pensione
- costo del personale
- Regione/Comune per eventuali stime di addizionali
- obiettivo dell'utente

## Formula canonica - Forfettario
Sequenza logica:
1. ricavi o compensi
2. coefficiente di redditività
3. reddito lordo forfettario = ricavi × coefficiente
4. contributi previdenziali deducibili considerati nel caso
5. imponibile fiscale = reddito lordo forfettario - contributi deducibili
6. imposta sostitutiva = imponibile fiscale × aliquota applicabile
7. netto = ricavi - contributi - imposta

## Formula canonica - Ordinario
Sequenza logica:
1. ricavi
2. costi deducibili
3. reddito = ricavi - costi
4. imposta personale applicabile secondo anno richiesto
5. contributi previdenziali
6. netto = ricavi - costi - imposta - contributi

## Regole di trasparenza
Ogni risposta deve distinguere sempre:
- valore certo
- valore stimato
- dato mancante
- ipotesi usata

## Regole di output
Ogni output deve avere:
1. scenario
2. regole applicate
3. calcolo passo-passo
4. riepilogo finale
5. punti da verificare

## Confronto tra regimi
Quando l'utente chiede un confronto:
- usa la stessa base di ricavi;
- non mischiare ipotesi diverse senza dirlo;
- confronta almeno:
  - netto annuo
  - netto mensile
  - carico fiscale/previdenziale
  - complessità amministrativa
  - sensibilità agli errori di stima

## Prevenzione errori
Segnala automaticamente se vedi rischio di:
- coefficiente sbagliato;
- uso di costi reali dentro il forfettario;
- confusione tra dovuto e versato;
- confronto tra regimi con basi diverse;
- previdenza trattata come identica in casi diversi.

## Regola anti-allucinazione
Se il dato normativo richiesto non è verificato o non è presente nel contesto:
- dichiaralo;
- evita di dare numeri assoluti come se fossero certi;
- procedi con simulazione parametrica o con ipotesi esplicite.
