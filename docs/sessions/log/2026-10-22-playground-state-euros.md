# 2026-10-22 · Playground : voix joignable et coûts en euros dans l'état (recette R-G14, Playground de l'Extension)

Fait :
- `PlaygroundStateSchema` : `voice.reachable` (une clé atteint le modèle de la voix ou son repli ; sinon un message répond 503) et `sessionCostEur`.
- `PlaygroundAnswerSchema` et `PlaygroundComparisonSchema` : `costEur` à côté de `costUsd`.
- Conversion au taux du budget journalier (`dailyBudget.usdPerEur`), le même que le plafond de 20 € (ADR 0011). Le moteur reçoit ce taux ; `assertAvailable` et l'état lisent la même règle de joignabilité.
- Fixtures web (`demo.ts`, `logic.test.ts`) complétées, sans changement d'écran.
- Tests : routes du playground (état sans dépense et joignable, coût en euros d'une réponse et de la session, `reachable` faux sans clé).

Pas fait : l'écran (fil Extension : en-tête « clé manquante » et coût en euros) ; retirer `costUsd` et `sessionCostUsd` du contrat une fois l'écran passé aux euros (PR à part, Bilan).

Décisions : champs en euros ajoutés à côté des champs en dollars plutôt que remplacés : l'écran change dans sa propre PR sans casser entre les deux.

Relectures : agent (module playground), Extension (fixtures web).

Découvertes : aucune.

Candidats à suppression : `costUsd` et `sessionCostUsd` du contrat du playground, après la PR de l'écran.

Vérifié : `pnpm check`, `pnpm test`, intégration `apps/api`.
