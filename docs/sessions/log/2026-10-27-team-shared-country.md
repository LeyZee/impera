# 2026-10-27 — Équipe › Membres : pays et drapeaux partagés — done

Fait : `screens/team` lit le nom et le drapeau d'un pays dans `lib/country.ts` (venu avec #189), au lieu d'avoir sa propre copie. Rien ne change à l'écran.
Pas fait : rien.
Décisions : la liste des 249 pays et l'ordre Bénin, Madagascar, France restent dans `screens/team/model.ts`, propre à l'ajout d'un membre.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, tests de `screens/team` et `lib` ✓.
