# 2026-10-27 — Modules vides sales et scripts retirés — done
Fait : `apps/api/src/modules/sales` et `apps/api/src/modules/scripts` (une fabrique `createXModule` sans code, trois `.gitkeep`, un README) sont supprimés, ainsi que leur câblage dans `composition-root.ts` et leurs lignes dans `MODULE_DEPENDENCIES` (`eslint.config.js`). Leur rôle et leurs tables passent dans `docs/architecture/modules.md`, marqués « non créé » comme `content` et `platform` ; la fiche PROPOSED-script-studio y renvoie.
Pas fait : rien.
Décisions : un module planifié entre dans la composition root et dans le graphe des frontières avec son premier code, pas avant (commentaire de `MODULE_DEPENDENCIES`). Suppression dans un commit `chore(cleanup)` séparé (hygiene.md), demandée par l’audit du 27/10.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓ ; `rg` sur les noms et les exports : plus aucune référence hors journal.
