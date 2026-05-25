# Claude Skills Pack

Pacchetto strutturato per Claude Code con skill specializzate e asset di supporto.

## Struttura
Ogni skill contiene:
- `SKILL.md` -> istruzioni principali
- `reference.md` -> regole canoniche e struttura operativa
- `examples.md` -> esempi di richieste e comportamento atteso
- `scripts/` -> blueprint, template o stub riutilizzabili
- `checklists/` -> checklist operative
- `test-prompts/` -> prompt per smoke test ed edge case

## Skill incluse
- `commercialista-fiscale`
- `fatturazione-creator`
- `frontend-calculator-ux`
- `financial-code-reviewer`
- `dichiarazione-forfettario`

## Uso consigliato
1. Parti da `SKILL.md`
2. Usa `reference.md` per rinforzare il comportamento
3. Usa `examples.md` per capire il formato ideale
4. Usa `checklists/` per validare il risultato
5. Lancia i prompt in `test-prompts/` per verificare il trigger e la qualità
