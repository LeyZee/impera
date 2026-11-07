# 2026-11-07 — Onglets du haut : une flèche quand ils dépassent l'écran — done

Fait : la barre d'onglets du haut (`SubNav`, `apps/web/src/shell/layout.tsx`) montre une flèche sur chaque bord qui cache des onglets, comme les onglets de la persona. Un appui fait défiler d'environ 70 % de la largeur (au moins 120 px), sans animation si l'utilisateur réduit les mouvements. La flèche n'entre pas dans l'ordre de tabulation : chaque onglet y est déjà. Sur ordinateur, rien ne change tant que les onglets tiennent sur une ligne. Captures validées par Charles (« ok captures onglets », 07/11 13 h 10) : `/mnt/project-files/recette/2026-11-07/extension/onglets-fleche-v1/`.
Pas fait : rien.
Décisions : la flèche est un raccourci pour le doigt et la souris, pas une commande clavier (`tabIndex={-1}`, nom accessible gardé).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests du shell (`SubNav.test.tsx`), `pnpm check` et `pnpm test` (hook pre-push), captures Nuit et Jour, ordinateur et téléphone.
