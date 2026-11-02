# ARC-01 Les sommes et la prévision de quinzaine rendues par le serveur
Statut : in-progress (partie serveur dans cette PR ; retrait côté web par le fil Extension)
Phase : exploitation
Dépend de : ADR 0047 § 2
Branche : claude/project-thread-fjrft0 (fil « Ranger l'architecture »)

## Objectif (1 phrase)

Le détail d'une quinzaine porte ses totaux (`summary`) et sa prévision (`pace`), calculés par le serveur avec les mêmes règles que la liste, pour que le dashboard n'additionne plus d'argent (ADR 0047 § 2).

## Contexte à lire (fichiers précis)

- ADR 0047 § 2 (une seule prévision d'objectif pour tous, « ok A » du 02/11).
- `packages/contracts/src/payroll.ts`, `apps/api/src/modules/payroll/application/periods.ts`, `apps/web/src/payroll/model.ts`.

## À faire (liste vérifiable)

- [x] `PeriodFiguresSchema` partagé par la ligne de liste et le détail ; `PeriodPaceSchema` (`lateNetMinor`, `forecastNetMinor`, `goal.reachedBps`, `goal.forecastReachedBps`).
- [x] `domain/period-figures.ts` : totaux, net tardif, prévision linéaire, part d'objectif atteinte, horloge injectée.
- [x] Prévision d'objectif identique pour chaque lecteur : le membre lit les deux sommes d'équipe par une lecture système qui ne rend que deux entiers.
- [x] Tests : unitaires du domaine ; intégration « summary == ligne de liste » pour owner, manager et deux membres ; même prévision d'objectif pour owner, manager et membre.
- [ ] Web (fil Extension) : `summaryOf`, `lateNetOf`, `forecastNet`, `teamNetOf`, `goalReachedBps`, `reachedBpsOf` quittent `apps/web/src/payroll/model.ts` au profit de `summary` et `pace`.

## Critères d'acceptation (tests, commandes, comportements observables)

- Aucun chiffre ne change pour l'owner et le manager ; le membre voit la même prévision d'objectif que l'owner.
- `pnpm check`, `pnpm test:all` et la CI verts.

## Hors périmètre

- Découpage de la paie (ADR 0047 § 1), assemblage (§ 3), dossiers du web (§ 4).

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- 02/11 : le net d'équipe d'un membre est lu par `teamTotalsUnscoped` (`withAdmin`, deux sommes seulement, jamais une ligne) : la RLS lui cache les relevés des autres.
