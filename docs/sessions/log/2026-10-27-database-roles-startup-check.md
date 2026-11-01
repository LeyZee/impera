# 2026-10-27 — Vérification des rôles de base au démarrage

- **Fil** : Bilan (plomberie). Découverte d’Extension pendant la recette du planning.
- **Fait** : `assertDatabaseRoles` dans `createApp`. Le serveur, le worker et les scripts refusent de démarrer si le rôle de `DATABASE_ADMIN_URL` n’a ni `BYPASSRLS` ni superutilisateur, ou si celui de `DATABASE_URL` contourne la RLS. Avant, une lecture `*Unscoped` répondait vide sans erreur (par exemple `/v1/scheduling/my-shifts`). Le runbook `deploy.md` § 1.1 le mentionne.
- **Tests** : `database-roles.integration.test.ts`.
- **Découvertes** : aucune.
