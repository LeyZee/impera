# SEC-11 Droits des tables en ajout seul et journaux de la bibliothèque d'authentification alignés sur la doc
Statut : done
Phase : exploitation
Dépend de : SEC-10
Branche : claude/project-thread-bfbfaz (fil « Sécurité »)

## Objectif (1 phrase)

Faire dire aux droits du rôle applicatif ce que `data-model.md` et les triggers disent déjà des journaux (on y ajoute, on ne les réécrit pas), et faire passer les lignes de Better Auth par le logger de l'application comme `coding.md` le demande de tout log.

## Contexte à lire (fichiers précis)

- `docs/architecture/data-model.md` (conventions, `audit_log`), `docs/conventions/security.md` (journal d'audit).
- `packages/db/migrations/0000_core.sql` (`refuse_change`, droits de `nirvana_app`), `packages/db/docker/init.sql` (privilèges par défaut), `packages/db/migrations/0191_service_role.sql`.
- `packages/db/src/service-role.integration.test.ts`.
- `apps/api/src/logger.ts` (sérialiseurs, `workerLoggerFrom`), `apps/api/src/auth.ts` (`createAuth`), `docs/conventions/coding.md` § Logs.

## À faire (liste vérifiable)

- [x] Migration 0212 : `nirvana_app` n'a plus `UPDATE`, `DELETE` ni `TRUNCATE` sur `audit_log`, `conversation_events`, `domain_events` et `platform_sales`.
- [x] `append-only.integration.test.ts` : sur le catalogue, aucune table qui porte un trigger `*_append_only` ne laisse `UPDATE`, `DELETE` ou `TRUNCATE` à `nirvana_app` ni à `impera_service`, sauf celles nommées dans le test avec leur raison.
- [x] `authLibraryLogFrom` : les lignes de Better Auth sortent par pino (niveau, message réduit par `storableError`, erreur par le sérialiseur `err`), plus par la console.
- [x] Docs : `data-model.md`, `security.md`, `coding.md`.

## Critères d'acceptation (tests, commandes, comportements observables)

- Le test échoue sans la migration et passe avec.
- Le rôle applicatif ajoute encore une ligne à `audit_log` ; une modification, une suppression et un vidage sont refusés par les droits.
- `session-database-outage.integration.test.ts` : base coupée, une requête connectée répond 503, rien de Better Auth ne sort sur la console, et sa ligne passe par le logger sans les valeurs de la requête.
- `pnpm check`, `pnpm test`, les suites d'intégration et la CI verts.

## Hors périmètre

- `calibration_ratings` garde `UPDATE` : son trigger ne laisse passer que la purge de `moment`.
- Les tables dont le trigger `*_kept` protège une partie des lignes seulement (`scheduling_slot_seats`, `script_structure_versions`).

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- Le comportement ne change pas : le trigger refusait déjà ces écritures pour tous les rôles, et aucun code ne modifie ni ne supprime une ligne de ces quatre tables. Seul le message d'un refus change (les droits répondent avant le trigger).
- `platform_sales` n'a l'écart que sur une base créée par `init.sql` (privilèges par défaut) ; la base des tests ne les pose pas, d'où sa présence dans la migration sans que le test ne l'ait signalée.
- Better Auth écrit par défaut sur la console, hors des sérialiseurs : une erreur de base y sortait entière. Son option `logger.log` reçoit le niveau, le message et les arguments ; on garde le message réduit et la première erreur, le reste est écarté.

## Résultat

Les quarante-deux tables en ajout seul ont les mêmes droits pour le rôle applicatif, et un test du catalogue le tient pour les suivantes. Toutes les lignes de l'API passent par le même logger et les mêmes sérialiseurs.
