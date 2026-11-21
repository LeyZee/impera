# 2026-11-20 — SEC-15 Primes et ajustements réservés au propriétaire — in_progress
Fait : garde `assertGivesPayOf` sur la prime, son annulation et l'ajustement ; politiques `owner_insert` et `owner_cancel` (migration nouvelle) ; tests des routes et des politiques par rôle ; écran « Primes et malus » et relevé réduits aux malus pour un manager ; README de `payroll`.
Pas fait : rien ; migration 0247 (ou la suivante libre au tour de fusion).
Décisions : aucune nouvelle, c'est la règle d'argent de Charles appliquée (le manager retire par un malus, seul le propriétaire donne ou corrige).
Découvertes : la table de `docs/sessions/tasks/EQ-05-payroll-screens.md` dit encore « propriétaire, manager actif » pour ces routes (fiche close, laissée telle quelle).
Candidats à suppression : aucun.
Vérifié : voir la PR.
