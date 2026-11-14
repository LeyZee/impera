# OPS-13 L'essai de restauration connaît les rôles de l'ADR 0087
Statut : done
Phase : exploitation
Dépend de : SEC-10
Branche : task/ops-13-restore-roles (fil « Bilan »)

## Objectif (1 phrase)

Que l'essai trimestriel de restauration (`restore.md` § C) passe tel qu'écrit depuis le rôle de service.

## Contexte à lire (fichiers précis)

- `ops/db-export/restore-check.sh`, `docs/runbooks/restore.md` § B et § C.
- `apps/api/src/database-roles.ts` : l'API refuse un `DATABASE_URL` qui contourne la RLS et exige `DATABASE_SERVICE_URL`.

## Cause

- Un export de la base de développement cite `nirvana_admin`, son propriétaire, dans ses droits par défaut ; sur un Postgres jetable ce rôle n'existe pas et `pg_restore` échoue (vu à la vérification de la sauvegarde du PC, le 13/11).
- L'étape 4 de § C branchait l'API en `postgres` sur `DATABASE_URL` et sans `DATABASE_SERVICE_URL` : depuis SEC-10, elle refuse de démarrer.

## À faire (liste vérifiable)

- [x] `restore-check.sh` crée aussi `nirvana_admin` sans connexion s'il manque.
- [x] `restore.md` § C étape 4 : connexion donnée à `nirvana_app` et `impera_service` dans le conteneur jetable, puis `DATABASE_URL` et `DATABASE_SERVICE_URL` de l'API ; l'essai se joue sur un export postérieur à 0191.

## Critères d'acceptation (tests, commandes, comportements observables)

- Le job « Docker images » (export puis `restore-check.sh`) reste vert.
- Le prochain essai sur le PC suit § C sans étape ajoutée à la main.

## Hors périmètre

- La restauration de production (§ B), déjà à jour par SEC-10.
