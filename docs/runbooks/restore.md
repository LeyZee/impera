# Restauration de la base

Deux mécanismes : **PITR Neon** (retour à un instant T, rapide) et **export chiffré quotidien** hors Neon (si Neon est indisponible ou le compte compromis).

## A. Retour à un instant T (erreur humaine, migration ratée)

1. Kill switch global.
2. Neon → projet → Restore → choisir l'instant (avant l'erreur). Neon crée une branche restaurée.
3. Vérifier sur la branche (`psql`) : les données attendues sont là.
4. Deux options : promouvoir la branche en principale (Neon), ou copier les tables touchées de la branche vers la principale (si l'erreur est localisée).
5. Mettre à jour `DATABASE_URL` si la branche a changé, redémarrer, `/ready`.
6. **Réconcilier** : `connector.reconcile` immédiat pour ré-ingérer les messages reçus entre T et maintenant ; vérifier qu'aucun draft `approved`/`sending` d'avant T ne sera renvoyé (les marquer `expired`).
7. Rallumer par paliers (`incident.md` §4).

## B. Depuis l'export (perte de Neon)

L'export (ADR 0028, service `backup`) est un tar chiffré par `age` : le dump `pg_dump --format=custom` (schéma et données de tous les schémas, sans les données de `session`, `verification` et `rate_limit_counters`) et un `manifest.json` (comptes de lignes au moment du dump, version de `pg_dump`). Il se restaure dans une base **vide**, sans rejouer les migrations.

1. Kill switch global si l'ancienne base répond encore.
2. Créer une base vierge (nouveau projet Neon, § 1.1 de `deploy.md` : rôle `nirvana_app` créé d'abord, rôle admin avec `BYPASSRLS`).
3. Sur le PC où se trouve la clé privée, récupérer le dernier export du bucket (clé d'accès en lecture seule), puis :
   `sh ops/db-export/restore-check.sh nirvana-<date>.tar.age nirvana-backup.key "<DATABASE_ADMIN_URL de la nouvelle base>"`.
   Le script déchiffre, restaure (`pg_restore --no-owner --single-transaction`), **vide la file `graphile_worker`** (aucun job d'avant le sinistre ne repart) et compare les comptes de lignes au manifeste.
4. Mettre `DATABASE_URL` et `DATABASE_ADMIN_URL` à jour dans Coolify, avec les **mêmes** `SESSION_ENCRYPTION_KEYS` et `CREDENTIALS_ENCRYPTION_KEYS` qu'avant (copie gardée avec la clé privée), redéployer, `/ready`.
5. Tout le monde se reconnecte (les sessions ne sont pas dans l'export). Étapes A.6 et A.7.

## C. Essai trimestriel (ADR 0028 § 6)

**Une sauvegarde non testée n'existe pas.** Tous les 3 mois, et une première fois dès la mise en service de l'export, une session Remote Control joue l'essai sur le PC de Charles. Charles approuve et fournit la clé privée et la clé d'accès en lecture seule ; il ne tape aucune commande. **Rien ne doit pouvoir partir pendant l'essai** : la copie contient la file des jobs, les comptes de plateforme, le bot Telegram et les clés des services.

1. Télécharger le dernier export du bucket ; noter son nom.
2. Un Postgres **jetable**, sans volume nommé, sur un réseau à lui : `docker network create nirvana-restore-test`, puis `docker run -d --rm --name nirvana-restore-db --network nirvana-restore-test -e POSTGRES_PASSWORD=<aléatoire> postgres:16-alpine`. Jamais la base de développement.
3. Restaurer et vérifier, avec l'image `backup` construite depuis le dépôt (`docker build -t nirvana-backup ops/db-export`) : `docker run --rm --network nirvana-restore-test -v <dossier de l'export>:/in:ro nirvana-backup /app/restore-check.sh /in/<export> /in/nirvana-backup.key postgres://postgres:<mot de passe>@nirvana-restore-db:5432/postgres`. Le script affiche l'empreinte SHA-256 de l'export, la durée, et les tables dont le compte diffère.
4. Démarrer **l'API seule**, jamais le worker, sur la copie : l’image de l’API avec `DATABASE_URL` et `DATABASE_ADMIN_URL` vers `nirvana-restore-db` (rôle `postgres` du conteneur jetable : `nirvana_app` y est créé sans connexion), et des `SESSION_ENCRYPTION_KEYS` / `CREDENTIALS_ENCRYPTION_KEYS` **aléatoires**, jamais les vraies : les colonnes chiffrées restent illisibles et rien ne peut joindre l'extérieur. `/ready` doit montrer `database` et `migrations` à vrai ; `worker` à faux est attendu.
5. En fin d'essai, réussi ou non : `docker stop nirvana-restore-db` (le conteneur `--rm` part avec son volume anonyme), `docker network rm nirvana-restore-test`, suppression de l'export téléchargé et de tout fichier déchiffré. Le compte rendu ne cite aucune donnée, seulement l'empreinte, la durée et des comptes.
6. Charles saisit l'essai dans l'application (état de mise en service, EQ-17 ; `POST /v1/backups/restore-tests`) : date de fin de l'essai (le moment où les comptes de lignes ont été comparés), durée, nombre d'écarts, empreinte. Le serveur le rapproche d'un export réussi de `backup_runs` et refuse une empreinte inconnue, un essai daté d'avant cet export ou dans le futur. L'essai compte 90 jours, et seulement le dernier : un essai raté remet la garde de paie au rouge jusqu'au suivant.

Les clés gardées avec la clé privée se vérifient à part, jamais pendant l'essai : `pnpm ops:check-keys` (`deploy.md` § 4.2), en lecture seule, sans rien appeler.
