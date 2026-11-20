# CHF-01 Chiffres et jeu du chatteur : il voit où il en est, et l'écran le lui rend
Statut : in_progress
Phase : équipe (ADR 0104 ; ADR 0043 § 7, ADR 0050 § 10, ADR 0092 § 1)
Dépend de : ADR 0104 (acceptée le 13/11/2026) ; « Mes ventes lues » (CRM-03 lot b4c, fait) ; Commissions (EQ-05, fait) ; pour le lot 3, la PR 2 d'ADR 0092 § 1 (chiffres d'un chatteur)
Branche : claude/project-thread-bg89go
Propriétaire proposé : le fil « Motiver le chatteur avec ses chiffres » ; relecteurs Design/UX (écrans), Équipe (chiffres de vente et de paie), Bilan (serveur, base)

## Objectif (1 phrase)

Le chatteur lit ses propres chiffres dans le style du Dashboard de l'agence (gain de la quinzaine, prochain palier, quand il vend, ses records), puis un jeu fait de faits réels (palier animé, série, défi du shift, trophées, niveaux) lui rend ses progrès, sans jamais toucher à la paie ni le comparer à un collègue.

## Contexte à lire (fichiers précis)

- ADR 0104 (toutes les règles), ADR 0043 § 7, ADR 0050 § 10, ADR 0092 § 1 et § 5.
- `packages/contracts/src/payroll.ts` (`MySalesSchema`), `apps/api/src/modules/payroll/domain/my-sales.ts`, `apps/api/src/modules/payroll/infra/sale-signal-store.ts` (`mySales`, `ownStatementSales`).
- `apps/web/src/screens/today/TodayPage.tsx`, `apps/web/src/screens/pay/CommissionsPage.tsx`, `apps/web/src/screens/pay/MySalesPanel.tsx`.
- `apps/web/src/screens/dashboard/agency/AgencyInsights.tsx` et `agency.css` (anneaux, barres, carte jour × heure, infobulles : le style à reprendre).
- `docs/design/README.md`, `packages/design-system/README.md`.

## À faire (liste vérifiable)

### Lot 1 : ses chiffres, sur les données qui existent (sans migration)

- [x] **Contrat** `MyFiguresSchema` et route `GET /v1/payroll/my-figures` (un membre, les siens) : le net par jour de la quinzaine en cours et de la précédente, la carte jour × heure sur 8 semaines, le meilleur jour et la meilleure quinzaine. Lu dans son relevé seulement.
- [x] **Domaine** pur et testé : jours, comparaison arrêtée au même jour, carte jour × heure dans le fuseau du membre, records, seuil de 30 ventes (§ 9).
- [x] Route au harnais d'isolation ; test « un chatteur ne lit pas les chiffres d'un autre ».
- [x] **Aujourd'hui** : carte compacte « Ma quinzaine » sous le shift (§ 2, § 3).
- [x] **Commissions › Ma performance** : barres par jour, anneau du prochain palier (§ 4), « Quand je vends » (§ 5), « Mes records » (§ 8). Écart négatif en encre neutre (§ 10).
- [x] Captures Nuit/Jour, PC/téléphone validées par Charles (lots `chiffres-chatteur-lot1-2` et `lot1-3`). Fusionné le 13/11 (#720).

### Médailles : la pièce à côté du palier (sans migration, PR à part)

- [x] `apps/web/src/rewards/` : `metals.ts` (métal d'un palier par son nom, sinon depuis le plus haut), `Medal.tsx`, `rewards.css` (Nuit et Jour).
- [x] Pièce du palier visé devant son nom sur « Ma quinzaine » ; pièces aux deux bouts de la jauge et médaille au laurier quand le plus haut palier est atteint, sur Commissions.
- [x] Captures validées par Charles (planche `medailles-planche-7`, écrans `medailles-ecran-lot1-2`).

### Lot 2a : gains, série, trophées, dévoilement (une migration, 0194)

- [x] Écussons de trophées, dévoilement d'un gain avec son (joué à l'arrivée sur Aujourd'hui ou Commissions, jamais sur une conversation, où une pastille « Voir » l'annonce), préférence « Sons » du compte (`user_preferences`, `PUT /v1/me/preferences`, interrupteur dans Moi › Préférences).
- [x] Module `rewards` : tables `reward_gains` et `reward_streaks` (FORCE RLS, l'application ne fait que lire et marquer un dévoilement vu), job rejouable `rewards.evaluate`, routes `GET /v1/rewards/my-trophy-case` et `POST …/reveals` (sans identifiant dans leur adresse : le serveur répond pour la session), test « chacun sa vitrine ».
- [x] Palier atteint (§ 12), série (§ 13), trophées (§ 15).
- [x] Tests : rien du jeu n'entre dans un relevé (§ 17) ; chacun sa vitrine ; mouvement réduit (§ 19) ; aucune notification (§ 18 : le jeu n'en envoie aucune).
- [x] Captures validées par Charles (lot `jeu-devoilement-2`), relectures Équipe, Bilan, Design, fusion (#740).

### Lot 2b : défi du shift, rangs, fiche du membre (PR à part, une migration, 0209 provisoire)

- [x] Défi du shift (§ 14) : `GET /v1/rewards/my-shift-challenge`, carte sur Aujourd'hui.
- [x] Rangs (§ 16) : huit rangs fixes et leurs insignes, seuils réglés par le propriétaire (`reward_level_settings`, Paie › Objectifs), carte « Mon rang » sur Commissions, dévoilement d'un rang gagné.
- [x] Lecture du rang, de la série et des trophées sur la fiche du membre pour le propriétaire et le manager (§ 20).
- [ ] Captures validées par Charles, relectures Équipe, Bilan, Design, numéro de migration confirmé, fusion.

### Lot 3 : quand les données arrivent

- [ ] Donut « D'où vient mon argent » : le type de vente sur la ligne de relevé du membre (§ 6).
- [ ] « Mes PPV » (§ 7), après la PR 2 d'ADR 0092 § 1.

## Critères d'acceptation (tests, commandes, comportements observables)

- `pnpm check`, `pnpm test`, `pnpm test:integration` verts.
- Un chatteur ne reçoit jamais un chiffre d'un autre, une moyenne d'équipe, une part d'agence ni un pseudo de fan.
- Sous 30 ventes, « Quand je vends » dit « Pas encore assez de ventes ».
- Chaque écran vu par Charles en captures avant fusion.

## Hors périmètre

- Classement, chiffre par heure montré au chatteur, récompense au hasard, notification hors shift (ADR 0104 § 11 et § 18).
- La carte des chatteurs payés à l'heure (§ 21) : aucun régime horaire n'existe.
- Une prime liée au jeu (§ 17).

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- 13/11/2026 : ADR 0104 acceptée, fiche ouverte.
- 13/11/2026, lot 1 : l'anneau du palier vit sur Aujourd'hui seulement ; Commissions garde sa jauge de « Ma performance » (une carte par sujet). Les graphiques se dessinent dans la devise qui rapporte le plus ; une autre devise reste lisible dans « Mes ventes lues ». Un chatteur payé sur rapports déclarés n'a pas de lignes `platform_net` : ses cartes n'apparaissent qu'avec ses premières ventes relevées. Tests d'intégration non joués en local (pas de Docker dans la session) : la CI les joue.
- 14/11/2026, lot 2b : Charles a choisi « rangs fixes, seuils à lui » ; l'écran dit « rang », le code `level`. Un défi réussi ne note aucun gain (pas de dévoilement). La vitrine gagne la famille `level` et un champ facultatif `nextLevel`. Le 15/11, Charles a choisi les noms « Charme » (Novice à Légende) à la place des noms romains ; insignes inchangés.
- 16/11/2026, suite du lot 2b : noms de la série « Feu » et insignes en médaillons de feu, validés par Charles sur planche ; libellés et dessin seulement, aucune migration. Reste : lot 3 (répartition par type de vente, « Mes PPV »).
- 16/11/2026, recette du jeu, premier lot (sans décision nouvelle) : jour du défi lu dans le fuseau du membre (CHT-07), « de net » sur le défi (CHT-34), net réel vers le rang suivant et jauge jamais pleine avant le gain (CHT-08), plusieurs rangs dus dévoilés en un seul, le plus haut (CHT-09), une cause par message dans le réglage des seuils (EQU-16), et les trois remarques de Design sur la PR des rangs « Feu ». Reste de la recette : CHT-04, CHT-11 et EQU-04 avec l'ADR 0118, puis le lot 3.
- 16/11/2026, ADR 0118 (recette CHT-04, CHT-11, EQU-04) : les rapports validés nourrissent le net du jeu (une source par shift), un gain que le net corrigé ne justifie plus est repris en silence et regagné il est dévoilé de nouveau, changer les seuils ne reprend rien ; migration 0223 ; textes des rangs revus. Reste : le récapitulatif de dévoilement au-delà de deux gains (CHT-09), le lot 3.
- 19/11/2026, suite de l'ADR 0118 (§ 10, accepté le 17/11 avec son lot de captures) : « Mes chiffres » compte les rapports validés comme le jeu, nommés pour ce qu'ils sont et jamais comptés comme des ventes ; une vente lue n'écarte le rapport d'un shift que sur le même compte ; bloc « Jeu » de la fiche d'un membre redessiné (rang d'abord). Aucune migration. Reste : la phrase de dévoilement avec le montant du seuil, le récapitulatif au-delà de deux gains (CHT-09), le lot 3.
- 19/11/2026, phrase du nouveau rang (ADR 0118 § 7) : le dévoilement d'un rang dit au chatteur le net qu'il vient de passer, lu dans le seuil gardé avec le rang (champ facultatif `basis` de la vitrine, donné à lui seul) ; un rang sans seuil gardé garde l'ancienne phrase. Aucune migration. Reste : le récapitulatif au-delà de deux gains (CHT-09), les jauges animées, le lot 3.
- 19/11/2026, cérémonie unique et jauges (recette CHT-09, seconde moitié) : une seule cérémonie à l'arrivée pour le gain le plus haut, les autres nommés dessous (« Aussi gagné ») ; jauges du jeu animées une fois depuis la dernière valeur vue. Web seulement, aucune migration. Reste : le lot 3 (répartition par type de vente, « Mes PPV »).
