# @nirvana/db

Schéma Drizzle (`src/schema/`), migrations SQL relues (`migrations/`), client et pool, `withTenant` / `withMember` / `withTenantMember` / `withAdmin` (RLS, ADR 0005 et 0023) et `enterCreator` (passer d'une créatrice à l'autre dans une même transaction, ADR 0031), chiffrement des secrets (`crypto.ts`, AES-256-GCM, clés versionnées, contexte lié), helpers de tests d'intégration (`src/test/`).

Commandes : `pnpm db:generate` (depuis le schéma), `pnpm db:migrate` (avec `DATABASE_ADMIN_URL`), `pnpm db:studio` (dev).

## Rôles

- `nirvana_admin` possède les tables et lance les migrations. En production : `NOSUPERUSER BYPASSRLS` (les jobs `*Unscoped` passent par `withAdmin`). Le test d'intégration le vérifie.
- `nirvana_app` : `NOSUPERUSER NOBYPASSRLS`, droits DML seulement (accordés par la migration). Toute requête de l'application passe par `withTenant(db, creatorId, fn)` ; hors de lui, les tables à `creator_id` renvoient zéro ligne.

## Écrire une migration

1. Modifier `src/schema/`, puis `pnpm db:generate --name <sujet>`.
2. Relire le SQL et compléter à la main dans le même fichier : `FORCE ROW LEVEL SECURITY` pour toute nouvelle table à `creator_id` (la politique vient de `tenantPolicy()` dans le schéma), `GRANT` à `nirvana_app`, triggers. La fin de `0000_core.sql` sert de modèle.
3. Une migration appliquée ne se modifie jamais (`hygiene.md`) ; expand/contract pour les colonnes (`operations.md`).

## Tests d'intégration

`pnpm --filter @nirvana/db test:integration` démarre un Postgres 16 avec Testcontainers (Docker requis), crée les deux rôles comme en production, puis une base migrée par fichier de test (`createTestDb`). Sans Docker, `NIRVANA_TEST_PG_URL` donne l'URL superutilisateur d'un Postgres 16 jetable à utiliser à la place.

## Écarts avec `data-model.md`

- L'index partiel des faits actifs filtre `superseded_by is null` seulement : `now()` n'est pas permis dans un prédicat d'index ; l'expiration se filtre à la requête.
- Les tables Better Auth (`src/schema/auth.ts`) sont écrites d'après son schéma de base ; P0-07a les compare à la sortie de sa CLI et migre si elle diffère.
