# OPS-14 Les lectures de connectors pour le MCP
Statut : review
Phase : exploitation
Dépend de : MCP lot a (porte et journal)
Branche : task/ops-14-connectors-reads (fil « Bilan »)

## Objectif (1 phrase)

Que le MCP lise les ventes relevées, leur lecture par chatteur, les relevés quotidiens et l'équipe importée par l'`index.ts` de connectors, comme la personne qui l'a branché, sans jamais une part d'agence ni de créatrice.

## Contexte à lire (fichiers précis)

- ADR 0026 § 1 (un outil MCP appelle une requête exposée par l'`index.ts` du module), ADR 0105 § 3 et § 4.
- ADR 0081 § 5 (relevés : propriétaire, ou manager actif qui a la créatrice dans sa liste), ADR 0043 § 7, ADR 0076 § 8.
- `apps/api/src/modules/connectors/infra/db/totals-reads.ts`, `daily-stats-store.ts`, `team-import-store.ts`.

## À faire (liste vérifiable)

- [x] Contrats `connector-reads.ts` : ventes sans `agencyMinor` ni `creatorMinor` (schémas stricts), lecture par chatteur, relevés quotidiens, équipe importée liée.
- [x] Règle d'accès dans le domaine (`readsCreatorFigures`) : propriétaire, ou manager actif pour les créatrices de sa liste ; vérifiée dans la transaction de la personne avant toute lecture.
- [x] `application/connector-reads.ts` : bornée par les identifiants de créatrices, une créatrice refusée refuse tout l'appel, période de 93 jours au plus.
- [x] Équipe importée lue dans la base seule : aucun appel à la plateforme, rien d'écrit.
- [x] `ConnectorsModule.reads` exporté par `index.ts` ; routes et jobs inchangés.

## Critères d'acceptation (tests, commandes, comportements observables)

- Tests unitaires du domaine et de l'application ; test d'intégration `connector-reads.integration.test.ts` (propriétaire, manager de la créatrice, manager hors liste, chatteur, créatrice).
- Aucune réponse ne contient de part d'agence ni de part de créatrice.

## Hors périmètre

- Les outils MCP eux-mêmes (fil MCP, PR suivante du lot a).
- Le panneau des ventes du Dashboard (supervision, inchangé).
