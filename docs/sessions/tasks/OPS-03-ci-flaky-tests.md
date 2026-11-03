# OPS-03 Les deux tests instables de la CI
Statut : done
Phase : exploitation
Dépend de : OPS-01, EQ-06 (seau des factures)
Branche : claude/project-thread-a8l1w6 (fil « Bilan »)

## Objectif (1 phrase)

Trouver la cause des deux tests qui ont fait relancer la CI (l'arrêt du worker sur SIGTERM, le seau des factures contre MinIO) et les rendre déterministes, sans les relancer automatiquement.

## Contexte à lire (fichiers précis)

- `apps/api/src/shutdown.ts`, `apps/api/src/worker.ts`, `apps/api/src/index.ts`, `apps/api/src/__tests__/shutdown.integration.test.ts`.
- `apps/api/src/modules/contractors/infra/invoice-buckets.ts` et ses deux tests.

## À faire (liste vérifiable)

- [x] Arrêt : les signaux sont écoutés dès la première ligne de chaque point d'entrée. Avant, `SIGTERM` n'avait d'écouteur qu'après le démarrage : le test l'envoyait dès « worker started », et quand le processus enfant n'avait pas encore installé l'écouteur, Node le tuait (code `null`, CI du 03/11). Un signal reçu pendant le démarrage est gardé, et l'arrêt suit la fin du démarrage.
- [x] Seau : MinIO ferme la connexion juste après un 412, sans `Connection: close`. Derrière docker-proxy, cette fermeture arrive parfois après le départ de la requête suivante sur la même connexion (`other side closed`, CI du 03/11). Une lecture (GET, HEAD) repart une fois sur une nouvelle connexion dans ce seul cas ; une écriture ne repart jamais.
- [x] Tests : `shutdown.test.ts` (un signal pendant le démarrage) ; un cas unitaire du seau (connexion fermée, deux fois fermée, PUT et délai jamais relancés) ; un cas d'intégration qui reproduit la CI à coup sûr, avec un proxy qui transmet la fermeture 50 ms en retard. Ce cas échoue sans le correctif avec l'erreur exacte de la CI.

## Critères d'acceptation (tests, commandes, comportements observables)

- Le cas d'intégration du proxy échoue sans le correctif et passe avec, à chaque exécution.
- Aucun test relancé automatiquement, aucun `retry` dans la configuration de Vitest ni dans le workflow.
- `pnpm check` et la CI verts ; aucune migration.

## Hors périmètre

- Le workflow de la CI : aucune des deux causes n'y est.
