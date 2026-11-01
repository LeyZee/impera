# 2026-10-27 — Dashboard : essai de restauration dans la bannière des sauvegardes (OPS-02) — done

Fait : la bannière ambre du propriétaire dit aussi quand l'essai de restauration n'est pas frais (`restoreTestFresh` faux) :
- aucun essai noté ;
- un dernier essai trop ancien, avec sa date ;
- un dernier essai qui n'a pas retrouvé toutes les lignes, sans jamais montrer ce que l'essai a imprimé.
Chaque cas rappelle qu'il en faut un de moins de 90 jours pour valider une paie (EQ-17). Quand la sauvegarde est à l'heure, c'est le titre « Aucun essai de restauration récent ». Quand elle est aussi en retard, c'est une ligne de plus sous son texte.
Pas fait : rien dans ce fil.
Décisions : la durée vient de `RESTORE_TEST_FRESH_DAYS`, la même borne que la garde de paie.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, tests du Dashboard ✓ (`backups.test.ts`, `DashboardPage.test.tsx`).
