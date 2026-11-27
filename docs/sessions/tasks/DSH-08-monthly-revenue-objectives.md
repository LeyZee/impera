# DSH-08 Le Dashboard de l'agence suit les objectifs mensuels par créatrice
Statut : done (relevé du 27/11/2026, décidé par Charles sur recommandation du fil « Remettre la documentation au propre » : le code de ce que la fiche liste est sur main ; vérifier en recette ce qui n'a pas été vu avec Charles) ; statut précédent : in-progress
Phase : pilotage
Dépend de : DSH-07, ADR 0092 § 6
Branche : claude/project-thread-v704ot
Propriétaire : fil « Compléter le Dashboard de l'agence » ; relecteurs Bilan (schéma, migration, routes), Design (apps/web)

## Objectif
Appliquer l'ADR 0092 § 6 : le propriétaire fixe un objectif de chiffre d'affaires par créatrice et par mois ; le Dashboard de l'agence, sur un mois, montre le réalisé, la projection linéaire jusqu'à la fin du mois et l'écart, pour chaque créatrice et pour l'agence (somme des objectifs fixés).

## Contexte à lire
ADR 0092 § 6, ADR 0078 (droits de lecture), ADR 0144 (le MCP ne lit jamais les objectifs), conventions des tables nouvelles (FORCE RLS, droits, tests de balayage).

## À faire
- [x] Base : table `creator_revenue_objectives` (un par créatrice et par mois, premier jour du mois, montant borné), RLS forcée, écriture du propriétaire seul, lecture propriétaire et managers, fermée à la créatrice ; rôle de service sans aucun droit (table dans `CLOSED`). Schéma validé par Bilan le 20/11.
- [x] Contrat : `objectives` dans `AgencyInsightsSchema`, paramètres et corps des écritures.
- [x] Supervision : lecture avec la période quand elle est un mois civil ; projection linéaire, nulle une fois le mois fini.
- [x] Routes : `PUT` et `DELETE /v1/dashboard/agency/objectives/:creatorId/:month`, propriétaire seul, chaque écriture dans `audit_log` (`objective.set` avec `from`/`to`, `objective.remove`).
- [x] Écran : carte « Objectifs du mois » (l'agence d'abord, puis chaque créatrice), saisie en euros sur place pour le propriétaire, lecture seule pour un manager.
- [x] Tests : domaine, intégration (droits, remplacement, journal, chatteur et créatrice à 0 ligne), balayages, MCP, écran.
- [x] Captures Nuit/Jour, PC/téléphone, données inventées ; avis Design, puis « ok captures dashboard-objectifs-1 » de Charles le 20/11.
- [ ] Migration renumérotée à son tour de file ; OK de Bilan et de Design sur le dernier commit.

## Critères d'acceptation
- Seul le propriétaire écrit ; un manager lit ; un chatteur et la créatrice ne lisent rien, ni par la route ni par la base.
- Aucun objectif dans la réponse du MCP.
- Aucune valeur réelle dans les tests, la doc ou les captures.

## Hors périmètre
Les objectifs par chatteur ou par équipe (EQ-04 a les siens).
