# 0005. Postgres + Drizzle + RLS par `creator_id`

<!-- bandeau-rangement-2026-11-27 -->
> **Changée en partie depuis.** Le texte ci-dessous est d’origine et reste valable, sauf pour les passages qu’une décision plus récente remplace. Ce qu’elle dit remplacer, avec ses propres mots :
>
> - [0152 · Hébergement : un VPS Hostinger avec Coolify, la base chez Supabase, les coffres de stockage chez d'autres fournisseurs](0152-hosting-hostinger-vps-and-supabase.md) : Remplace : l'ADR 0027 sur le lieu (le VPS Hetzner) et l'ADR 0005 sur la base de production (Neon). Le reste de ces deux ADR ne change pas.
>
> Toutes les décisions du même sujet : [`docs/regles/fondations.md`](../regles/fondations.md).
<!-- /bandeau-rangement-2026-11-27 -->

Statut : accepted
Date : 2026-10-16

## Contexte

Il faut une base relationnelle pour les conversations, le journal d'événements, la mémoire fan, les médias, les ventes, les jobs. Les données sont sensibles (intime, commercial). Le projet est mono-créatrice aujourd'hui, multi-créatrices possible demain. Imperium utilisait SQLite + Prisma ; OnlyScript n'avait pas de base.

## Décision

- **PostgreSQL 16+** (Neon en prod avec PITR et scale-to-zero désactivé ; Testcontainers en test ; Docker en dev).
- **Drizzle ORM** : schéma en TypeScript (`packages/db/src/schema/`), migrations SQL générées puis **relues et versionnées** (`packages/db/migrations/`), jamais `push` en prod.
- **Un rôle non-superuser** pour l'application. **RLS** sur toute table portant `creator_id` ; chaque unité de travail passe par `withTenant(creatorId, tx => …)` qui fait `SET LOCAL app.creator_id`. Les jobs multi-tenant utilisent un rôle admin explicite dans des fonctions `*Unscoped`.
- Une seule base, un seul schéma applicatif ; Graphile Worker dans son schéma `graphile_worker`.
- Enums en `text` + `check`, valeurs dans `packages/contracts`.

## Conséquences

- La séparation des données entre créatrices est garantie par la base, pas par la discipline du code. Une requête oubliant un `where creator_id` ne fuit rien.
- Drizzle garde le SQL visible : les sessions Opus comprennent ce qui s'exécute.
- Coût : `withTenant` partout ; un test d'intégration vérifie que l'oublier échoue.

## Alternatives rejetées

- **SQLite** (comme Imperium) : pas de RLS, pas de concurrence pour un worker, pas de PITR managé.
- **Prisma** : plus magique, migrations moins transparentes, moins bon pour les requêtes complexes du dashboard.
- **MongoDB** : les données sont relationnelles (fan → conversations → messages → événements) et les invariants (unicité d'identifiants plateforme) sont relationnels.
