# 2026-11-20 — OPS-21 Évaluations de l'IA chaque nuit — in_progress
Fait : `--cap-eur` pour `pnpm evals` (plafond d'un passage abaissé, dépense écrite à la fin) ; étape « Plan de la nuit » du job `nightly-evals` (3 tirages à 4 € le dimanche et à la main, 1 tirage à 1,50 € après un changement de l'IA, rien sinon) ; garde 7 de `check-repo` adaptée ; docs des évals.
Pas fait : les clés de la CI, que Charles crée et saisit lui-même dans les secrets du dépôt ; le premier passage à la main.
Décisions : rythme et plafonds choisis par Charles le 20/11 (carte du fil Bilan) ; « l'IA a changé » = un commit en 26 h sous packages/llm, les modules agent, persona et conversations, la persona, les évals.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, tests de `judge-model`, garde 7 éprouvée sur trois mutations du workflow.
