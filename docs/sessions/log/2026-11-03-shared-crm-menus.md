# 2026-11-03 — Table des menus partagée par le CRM et le popup — done
Fait : `packages/contracts/src/rails.ts` porte les sections, leurs noms, le menu de chaque rôle, sa barre du téléphone et les raccourcis du popup, avec `railKindOf` ; `apps/web/src/shell/nav.ts` y lit son menu (les icônes restent dans le CRM) ; `apps/extension/src/lib/who.ts` y lit ses raccourcis ; la créatrice a maintenant Agenda dans son popup ; un test refuse un raccourci absent du menu de son rôle ou plus de quatre raccourcis ; ADR 0066 § 6 et Conséquences amendés mot pour mot (« ok phrases 0066 », Charles, 19 h 03) ; glossaire : Menu, Raccourci.
Pas fait : rien.
Décisions : les raccourcis sont écrits dans la table, rôle par rôle, plutôt que déduits de la barre du téléphone, pour garder ceux qu'a acceptés Charles (le propriétaire garde Créatrices, sa barre du téléphone a Paie).
Découvertes : rien.
Candidats à suppression : rien.
Vérifié : `packages/contracts` (table) 17/17 ✓, `apps/web` shell 80/80 ✓, `apps/extension` 53/53 ✓, `pnpm check` ✓.
