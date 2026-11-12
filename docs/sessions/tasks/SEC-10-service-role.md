# SEC-10 Rôle de service de la base : l'API et le worker ne se connectent plus en propriétaire (ADR 0087, lot a)
Statut : done
Phase : exploitation
Dépend de : SEC-08, ADR 0087 (acceptée le 12/11/2026)
Branche : claude/project-thread-bfbfaz (fil « Corriger les failles de l'audit sécurité »)

## Objectif (1 phrase)

Brancher `withAdmin` et la file des jobs sur un rôle qui lit et écrit des lignes et rien d'autre, et faire refuser à l'API et au worker de démarrer sur un rôle qui peut plus.

## Contexte à lire (fichiers précis)

- `docs/adr/0087-service-role-between-app-and-owner.md` (lots a, b, c), `docs/adr/0005-*.md`.
- `packages/db/src/client.ts` (`withAdmin`), `packages/db/src/migrate.ts`, `apps/api/src/database-roles.ts`, `apps/api/src/composition-root.ts`.
- `docs/runbooks/deploy.md` § 1.1, `docs/runbooks/local-dev.md`.

## À faire (liste vérifiable)

- [x] Migration 0172 : le rôle `impera_service` (créé sans connexion s'il manque), lecture sur les tables, écriture table par table d'après ce que les appels `withAdmin` font, `audit_log` en ajout seul.
- [x] `runMigrations` pose aussi le schéma de la file des jobs et ses droits : l'API ne le crée plus à son démarrage.
- [x] `DATABASE_SERVICE_URL` ; l'API et le worker ne lisent plus `DATABASE_ADMIN_URL` (gardée pour les migrations, la sauvegarde et les scripts `ops:*`).
- [x] `pnpm db:migrate` donne au rôle le mot de passe de `DATABASE_SERVICE_URL` quand il ne se connecte pas encore.
- [x] Garde au démarrage : le rôle de service ne possède rien, n'est pas superutilisateur, ne crée ni rôle ni base.
- [x] Les tests d'intégration tournent avec les trois rôles ; `service-role.integration.test.ts` tient la liste des tables écrites.
- [x] Docs : `deploy.md`, `local-dev.md`, `restore.md`, `security.md`, `data-model.md`, `testing.md`, README de `packages/db`, glossaire, `.env.example`, CI.

## Critères d'acceptation (tests, commandes, comportements observables)

- `service-role.integration.test.ts` : le rôle lit chaque table, n'écrit que celles de la liste, ajoute à `audit_log` sans pouvoir le réécrire, et se voit refuser toute création, modification ou suppression d'objet, de politique ou de rôle.
- `database-roles.integration.test.ts` : l'API refuse de démarrer sur le propriétaire des tables ou sur un superutilisateur.
- Toute la suite d'intégration de l'API passe avec `withAdmin` sur `impera_service`.
- `pnpm check`, `pnpm test` et la CI verts.

## Hors périmètre

- Lot b (plafond du nombre d'appels `withAdmin` par module) et lot c (réduction module par module).
- Renommer `nirvana_admin` en `impera_owner`, et `adminDb` / `withAdmin` dans le code : les noms restent, la connexion change.
- Retirer `DATABASE_ADMIN_URL` de l'environnement des conteneurs `api` et `worker` : les scripts `ops:*` s'y lancent encore.

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- La liste des écritures vient de trois sources croisées : les écritures réellement faites par le rôle pendant toute la suite d'intégration (journal de Postgres), une lecture des appels `withAdmin` du code, et les tables fermées à `nirvana_app`. Un `INSERT … ON CONFLICT DO UPDATE` demande aussi `UPDATE`.
- Une table nouvelle ne donne rien au rôle : sa migration dit ce qu'elle ouvre, et le test de `packages/db` échoue tant que ce n'est pas dit.
- Graphile Worker ne peut plus créer son schéma depuis l'API : `runMigrations` le fait en propriétaire (dépendance `graphile-worker` ajoutée à `@impera/db`, même version que l'API).
- Le rôle est créé par la migration sans connexion ni mot de passe : aucun mot de passe dans le dépôt. `pnpm db:migrate` lui donne celui de `DATABASE_SERVICE_URL`.
- Un test du planning lisait `pg_stat_activity` en propriétaire : un rôle n'y voit que l'attente de ses propres sessions, il lit maintenant en rôle de service.

## Résultat

L'API et le worker ne peuvent plus créer, modifier ni supprimer une table, retirer une politique de lignes, changer un droit ni réécrire le journal d'audit ; ce que le code de service a le droit d'écrire se lit dans une migration et dans un test.
