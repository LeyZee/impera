# 2026-10-22 · Playground : le contrat ne donne plus que des euros

Fait : `costUsd` (réponse, comparaison) et `sessionCostUsd` (état) sortent du contrat du Playground. Depuis #128, aucun écran ne les lisait plus. Le moteur garde son cumul en dollars, l'unité du journal `llm_calls`, et ne rend que les euros (ADR 0011). Les fixtures web (`demo.ts`, `logic.test.ts`, `RateBar.test.tsx`) et le test des routes suivent.

Pas fait : rien.

Décisions : aucune ; c'était le candidat à suppression laissé par #122.

Relectures : agent (module playground), Extension (fixtures web).

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test`.
