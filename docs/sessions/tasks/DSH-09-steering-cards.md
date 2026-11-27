# DSH-09 Le pilotage de l'agence : objectif du jour, trafic, gros fans, IA
Statut : done (relevé du 27/11/2026, décidé par Charles sur recommandation du fil « Remettre la documentation au propre » : le code de ce que la fiche liste est sur main ; vérifier en recette ce qui n'a pas été vu avec Charles) ; statut précédent : in-progress
Phase : pilotage
Dépend de : DSH-08, ADR 0092 (avenant du 21/11/2026)
Branche : claude/project-thread-igl0y6
Propriétaire : fil « Choisir les métriques pour piloter l'agence » ; relecteurs Bilan (route, lecture), Design (apps/web), Sécurité (pseudos des fans sur le Dashboard)

## Objectif
Appliquer l'avenant du 21/11/2026 de l'ADR 0092 : des cartes de pilotage reliées chacune à une décision, avant les chiffres de la période, et les corrections de l'audit du Dashboard.

## À faire
- [x] Contrat `AgencySteeringSchema`, route `GET /v1/dashboard/agency/steering`, lecture par créatrice dans son tenant, calculs purs testés.
- [x] Écran : « Objectif du jour », « Du trafic à l'argent », « Dépendance aux gros fans » ; « Les fans qui paient » retirée.
- [x] Pastilles d'écart sans couleur sous le seuil du § 5.
- [x] « Des fans t'attendent » en tête du Dashboard de l'agence (point 2 de la grande recette).
- [x] Grande recette : panier moyen sur les ventes gardées (PRO1-02), objectif au centime (PRO1-17), anneau de focus des choix de période (DS-03), essai de restauration sans blocage de paie (PRO2-01).
- [ ] Carte « L'IA rapporte-t-elle ? » sur le calcul de Consommation IA, une fois sa PR fusionnée.
- [ ] Captures Nuit/Jour, PC/téléphone ; avis Design ; « ok captures » de Charles.
- [ ] OK Bilan, Design, Sécurité ; train de fusion.

## Critères d'acceptation
- Un chatteur, un opérateur de son seul périmètre et la créatrice reçoivent 403 ; un manager ne lit que sa liste.
- Aucun identifiant de fan chez la plateforme ne sort du serveur ; un pseudo seulement dans « Ont décroché ».
