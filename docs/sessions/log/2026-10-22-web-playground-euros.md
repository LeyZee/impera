# 2026-10-22 — Playground : « Clé manquante » dès l'ouverture, coûts en euros — done
Fait : l'en-tête du Playground lit `voice.reachable` (#122) : sans clé qui atteigne le modèle de la voix, une pastille ambre « Clé manquante » mène à Réglages › Modèles IA avant le premier message, au lieu de l'apprendre au 503, et l'en-tête ne montre alors ni modèle ni montant (relevé de la recette PC : « 0,00 $ cette session » et « grok-4.7 » sans aucune clé). Le coût de la session (`sessionCostEur`) et celui de chaque réponse dans « Détails techniques » (`costEur`) passent en euros (ADR 0011) ; une réponse qui coûte moins d'un centime l'écrit « moins de 0,01 € » plutôt que « 0,00 € ». `usd()` disparaît, `euros()` le remplace.
Pas fait : retirer `costUsd` et `sessionCostUsd` du contrat (PR à part de Bilan, l'écran ne les lit plus).
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓ (web) ; `RateBar.test.tsx` (modèle et coût en euros avec clé ; sans clé, ni modèle ni montant, « Clé manquante » mène aux réglages), `euros()` dans `logic.test.ts`.
