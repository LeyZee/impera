# 2026-10-28 — Planning : délai du premier test — done
Fait :
- `PlanningPage.test.tsx` : le premier `findByRole` du fichier attend 4 s au lieu de 1 s, comme `TrackingPage.test.tsx` (`BackupsSection.test.tsx` attend 3 s). Le premier rendu du fichier (routeur, requêtes) dépassait la seconde par défaut sur un runner chargé : la CI de #252 et de #261 est tombée sur ce test alors qu'aucune des deux ne touchait le planning.
Pas fait : rien.
Décisions : aucune ; le test et ce qu'il vérifie sont inchangés.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ; `PlanningPage.test.tsx` (16 tests).
