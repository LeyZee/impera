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
- [ ] Captures Nuit/Jour, PC/téléphone validées par Charles (lot `chiffres-chatteur-lot1`, montré le 13/11).

### Lot 2 : le jeu (migration 0178 réservée)

- [ ] Table des trophées gagnés, des défis de shift et des seuils de niveaux (FORCE RLS) ; job rejouable à la clôture d'un shift.
- [ ] Palier vivant (§ 12), série (§ 13), défi du shift (§ 14), trophées (§ 15), niveaux (§ 16) ; lecture sur la fiche du membre pour le propriétaire et le manager (§ 20).
- [ ] Tests : rien du jeu n'entre dans un relevé (§ 17) ; aucune notification hors shift (§ 18) ; mouvement réduit (§ 19).

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
