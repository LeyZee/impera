# 2026-11-03 — SC-01 lot a : structures de script, versions figées, file par créatrice — in-progress
Fait : module `scripts` (feuille) ; contrat `scripts.ts` avec les règles de structure partagées avec l'écran (`scriptStructureFaults`, `scriptSegmentCodes`) ; domaine (limites de la persona, décision d'enregistrement, vue de la file) ; migration 0084 (bibliothèque sous les politiques de l'équipe, file sous la RLS de la créatrice, déclencheur de la règle 6) ; routes `/v1/script-structures` et `/v1/creators/:creatorId/script-queue` ; tests unitaires, RLS et API.
Pas fait : rendu des cartons (lot b), écran Structures et structures de départ (lot c).
Décisions : règles de structure dans le contrat, pas seulement dans le domaine, pour que l'écran refuse comme le serveur ; filtre d'une étape sur `never_do`, `never_show`, `disgusts` (pas `never_say`), de l'accroche d'un pont sur `never_say` et `disgusts` (relecture Agent) ; sans persona active, la file n'est pas filtrée et le dit ; champ `mediaSlots` (glossaire).
Découvertes : aucune.
Vérifié : pnpm check, pnpm test, tests d'intégration des nouveaux fichiers sur un Postgres 16 local.
