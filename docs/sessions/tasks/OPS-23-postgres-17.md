# OPS-23 Le développement, les tests et la sauvegarde sur Postgres 17, la version de la production
Statut : review
Phase : exploitation
Dépend de : ADR 0152 § 2 (version de Postgres), OPS-19
Branche : claude/project-thread-nnqahk (branche imposée par la session)

## Objectif
La base de production (Supabase) est en Postgres 17. Les migrations, les tests d'intégration et l'image de sauvegarde tournent sur la même version majeure avant le premier `migrate` de production.

## Contexte à lire
ADR 0152 § 2, ADR 0028 § 1, `docker-compose.yml`, `packages/db/src/test/global-setup.ts`, `ops/db-export/Dockerfile`, `docs/runbooks/restore.md`.

## À faire
- [x] Postgres de développement en 17 (`docker-compose.yml`), image réglable par `IMPERA_POSTGRES_IMAGE` pour une machine qui garde un volume 16 tant que ses données ne sont pas déplacées.
- [x] Testcontainers en 17 (`packages/db/src/test/global-setup.ts`), donc la CI aussi.
- [x] Image `backup` en `postgres:17.12-alpine`, épinglée par empreinte (même version mineure que Supabase le 27/11).
- [x] `init.sql`, migrations complètes et tests d'intégration verts sur 17.
- [ ] Le PC de Charles : son volume de développement est en 16. Avant qu'il ramène `main`, Bilan déplace ses données (export puis restauration dans un volume 17) ou pose `IMPERA_POSTGRES_IMAGE=postgres:16-alpine` dans son `.env`, avec son mot dans le fil Bilan.

## Critères d'acceptation
- Aucune image Postgres 16 ne reste dans le code, la CI ni les runbooks, sauf le réglage documenté pour un ancien volume.
- `pnpm db:migrate` et `pnpm test:integration` passent sur Postgres 17.

## Hors périmètre
La migration des données de développement de Charles (fil Bilan).
