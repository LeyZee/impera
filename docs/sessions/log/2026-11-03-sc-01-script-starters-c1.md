# 2026-11-03 — SC-01 lot c1 : structure de départ d'OnlyScript — in-progress
Fait : `SCRIPT_STARTERS` dans les contrats (structure d'OnlyScript, noms d'étapes tels quels, ADR 0064 § 4), route `GET /v1/script-structures/starters`, tests (règles de structure, couleur lisible, noms et ponts, duplication par `POST`), glossaire « Structure de départ ».
Pas fait : l'écran Créatrices › Structures (lot c2).
Décisions : la structure de départ est une donnée des contrats, pas une ligne en base : chaque agence la duplique, rien n'est semé.
Découvertes : aucune.
Vérifié : pnpm check, tests des contrats, test d'intégration du module sur un Postgres 16 local.
