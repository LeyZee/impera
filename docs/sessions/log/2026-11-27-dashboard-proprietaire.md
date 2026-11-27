# 2026-11-27 — Dashboard du propriétaire, lot 1 — review

- **Fiche** : DSH-10, maquette validée par Charles (« ok maquette »), ADR 0092 avenant du 27/11.
- **Fait** : `AgencyPage` réécrite : période dans l'en-tête, « À toi », « L'argent » (`OwnerMoney` : objectif, barre et rythme, courbe du cumul lisible au survol, au toucher et au clavier, aujourd'hui, trois parts, écart), « Pour creuser » (`Dig`, corps monté à l'ouverture), ligne des blocs muets. Phrases pures dans `owner.ts`. Cartes existantes réutilisées telles quelles dans les replis.
- **Tests** : `owner.test.ts` (9), `AgencyPage.test.tsx` adapté (14) ; 1 288 tests des écrans verts.
- **Reste** : captures et OK de Design ; lot 2 après la mise en ligne.
- **Découvertes** : `SteeringPanel` ne sert plus qu'au Dashboard d'une créatrice ; son texte « Fixe-le dans Objectifs du mois, plus bas » y renvoie à une carte qui n'est que sur la page de l'agence.
