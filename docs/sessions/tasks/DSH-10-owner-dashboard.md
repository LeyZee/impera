# DSH-10 Le Dashboard du propriétaire : l'argent d'abord, le reste replié
Statut : review (lot 1, écran seul ; fusion après la mise en ligne)
Phase : pilotage
Dépend de : DSH-08, DSH-09, ADR 0092 (avenant du 27/11/2026)
Branche : claude/project-thread-kpor1n
Propriétaire : fil « Concevoir le Dashboard du propriétaire » ; relecteurs Design (apps/web), Bilan (fusion)

## Objectif
Appliquer la maquette validée par Charles le 27/11/2026 : un Dashboard où l'œil va d'abord à ce qui attend, puis à l'argent du mois face à son objectif, le reste replié sur des lignes qui répondent déjà.

## À faire
- [x] Lot 1, écran seul sur les données existantes : période dans l'en-tête, « À toi », « L'argent » (chiffre, objectif, barre et rythme, courbe du cumul au survol et au clavier, aujourd'hui, trois parts, écart), « Pour creuser » replié, ligne des blocs muets.
- [x] Tests : fonctions pures (`owner.test.ts`), page (`AgencyPage.test.tsx` adapté).
- [ ] Captures Nuit/Jour, PC/téléphone ; OK de Design.
- [ ] Lot 2 (après la mise en ligne, avec Bilan) : phrase de verdict, cartes « En ce moment », version courte du manager.

## Critères d'acceptation
- Sans objectif fixé, aucune pastille ni barre : jamais « en retard » face à rien.
- Le corps d'une ligne repliée ne se monte qu'à son ouverture.
- Un compte limité à son périmètre ne voit ni le trafic ni les gros fans.
