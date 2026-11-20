# OPS-20 Les tests de la CI en parallèle
Statut : done
Phase : exploitation
Dépend de : OPS-01
Branche : task/ci-split-tests

## Objectif
Une PR attend environ un quart du temps de CI qu'elle attendait, sans retirer un seul test (Charles, 20/11/2026 : la file de fusion est trop lente). Chaque test tourne toujours sur chaque PR.

## À faire
- Le job « Tests » devient une matrice : les unitaires, l'e2e et l'intégration découpée en quatre par Vitest (`--shard`), chacun sur sa machine avec son Postgres.
- Un job « Tests (unit + integration) » garde le nom que la protection de main exige et n'est vert que si toutes les parties le sont.
- « Build » n'attend plus que « check » : il ne lit rien des tests.

## Critères d'acceptation
- Les six parties et « Tests (unit + integration) » sont vertes sur la PR ; une partie rouge rend le job agrégé rouge.
- La durée totale de la CI d'une PR baisse nettement (environ 25 minutes avant).

## Hors périmètre
Lancer seulement les suites touchées (la RLS et les migrations touchent tout), changer les protections de main.

## Notes de session
- 20/11/2026 : fait. Une partie sans fichier dans son quart passe (`--passWithNoTests`), car `packages/db` a peu de tests d'intégration.
