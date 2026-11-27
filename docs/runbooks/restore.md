# Restauration de la base

Deux mécanismes (ADR 0152 § 2) : la **sauvegarde du jour de Supabase** (retour au jour précédent, sans rien télécharger) et notre **export chiffré quotidien** hors Supabase, la sauvegarde de référence (si Supabase est indisponible, le compte compromis, ou si l'instant voulu n'est pas dans ses sauvegardes). Le retour à n'importe quel instant (PITR) n'existe chez Supabase qu'en option payante, que Charles n'a pas prise.

## A. Retour à la sauvegarde du jour (erreur humaine, migration ratée)

1. Kill switch global, puis Coolify → Stop sur `api`, `worker` et `backup` : la restauration remplace toute la base.
2. Supabase → Database → Backups → la sauvegarde d'avant l'erreur → Restore. Le projet est indisponible pendant la restauration ; ce qui a été écrit depuis cette sauvegarde est perdu. Si l'erreur est localisée et récente, préférer § B sur une base jetable, puis recopier les seules tables touchées.
3. Rejouer `packages/db/supabase/lock-down.sql` (`deploy.md` § 1.4, étape 2) : une restauration remet les droits de l'instant sauvegardé.
4. Coolify → Start, `/ready`.
5. **Réconcilier** : `connector.reconcile` immédiat pour ré-ingérer les messages reçus entre T et maintenant ; vérifier qu'aucun draft `approved`/`sending` d'avant T ne sera renvoyé (les marquer `expired`).
6. Rallumer par paliers (`incident.md` §4).

## B. Depuis l'export (perte de Supabase ou du projet)

L'export (ADR 0028, service `backup`) est un tar chiffré par `age` : le dump `pg_dump --format=custom` (schéma et données de tous les schémas, sans les données de `session`, `verification` et `rate_limit_counters`) et un `manifest.json` (comptes de lignes au moment du dump, version de `pg_dump`). Il se restaure dans une base **vide**, sans rejouer les migrations.

1. Kill switch global si l'ancienne base répond encore.
2. Créer une base vierge : un nouveau projet Supabase, `deploy.md` § 1.1 étapes 3 à 6 (services coupés, réseau, les trois rôles et `btree_gist`), dans une organisation sans aucun connecteur. À vérifier au premier essai sur Supabase : `pg_restore` dans un projet neuf, qui contient déjà les schémas de Supabase, ne doit toucher qu'aux nôtres. Puis, après la restauration, `lock-down.sql` (`deploy.md` § 1.4, étape 2).
3. Sur le PC où se trouve la clé privée, récupérer le dernier export du bucket (clé d'accès en lecture seule), puis :
   `sh ops/db-export/restore-check.sh impera-<date>.tar.age impera-backup.key "<DATABASE_ADMIN_URL de la nouvelle base>"`.
   Le script déchiffre, restaure (`pg_restore --no-owner --single-transaction`), **vide la file `graphile_worker`** (aucun job d'avant le sinistre ne repart) et compare les comptes de lignes au manifeste.
4. Le script a créé `nirvana_app` et `impera_service` sans connexion : leur donner un mot de passe neuf, dans l'éditeur SQL (`ALTER ROLE nirvana_app LOGIN PASSWORD '<mot de passe>';` puis `ALTER ROLE impera_service LOGIN PASSWORD '<un autre>' BYPASSRLS;`, et le `GRANT CONNECT` de `deploy.md` § 1.1), puis mettre `DATABASE_URL`, `DATABASE_SERVICE_URL` et `DATABASE_ADMIN_URL` à jour dans Coolify, avec les **mêmes** `SESSION_ENCRYPTION_KEYS` et `CREDENTIALS_ENCRYPTION_KEYS` qu'avant (copie gardée avec la clé privée), redéployer, `/ready`.
5. Tout le monde se reconnecte (les sessions ne sont pas dans l'export). Étapes A.5 et A.6.

Ce que la restauration par l'export perd en plus : l'heure de **prise de poste** des shifts (`shifts.checked_in_at`, migration 0247). Le déclencheur qui l'efface à chaque insertion joue aussi pendant le `COPY` de `pg_restore` : les shifts reviennent, sans l'heure où leur membre a pris son poste. Elle ne compte ni dans la paie ni dans l'attribution des ventes ; rien à refaire.

## C. Essai trimestriel (ADR 0028 § 6)

**Une sauvegarde non testée n'existe pas.** Tous les 3 mois, et une première fois dès la mise en service de l'export, une session Remote Control joue l'essai sur le PC de Charles. Charles approuve et fournit la clé privée et la clé d'accès en lecture seule ; il ne tape aucune commande. **Rien ne doit pouvoir partir pendant l'essai** : la copie contient la file des jobs, les comptes de plateforme, le bot Telegram et les clés des services.

1. Télécharger le dernier export du bucket ; noter son nom.
2. Un Postgres **jetable**, sans volume nommé, sur un réseau à lui : `docker network create impera-restore-test`, puis `docker run -d --rm --name impera-restore-db --network impera-restore-test -e POSTGRES_PASSWORD=<aléatoire> postgres:17-alpine`. Jamais la base de développement.
3. Restaurer et vérifier, avec l'image `backup` construite depuis le dépôt (`docker build -t impera-backup ops/db-export`) : `docker run --rm --network impera-restore-test -v <dossier de l'export>:/in:ro impera-backup /app/restore-check.sh /in/<export> /in/impera-backup.key postgres://postgres:<mot de passe>@impera-restore-db:5432/postgres`. Le script affiche l'empreinte SHA-256 de l'export, la durée, et les tables dont le compte diffère.
4. Démarrer **l'API seule**, jamais le worker, sur la copie. L'API refuse de démarrer si `DATABASE_URL` contourne la RLS ou si `DATABASE_SERVICE_URL` manque (ADR 0087) : donner d'abord une connexion aux deux rôles que le script a créés sans, avec deux mots de passe aléatoires que l'essai oublie ensuite, `docker exec impera-restore-db psql -U postgres -c "ALTER ROLE nirvana_app LOGIN PASSWORD '<aléatoire 1>'" -c "ALTER ROLE impera_service LOGIN PASSWORD '<aléatoire 2>'"`. Puis l’image de l’API sur le réseau `impera-restore-test`, avec `DATABASE_URL` en `nirvana_app` et `DATABASE_SERVICE_URL` en `impera_service`, vers `impera-restore-db`, sans `DATABASE_ADMIN_URL` (l'API ne s'en sert pas), et des `SESSION_ENCRYPTION_KEYS` / `CREDENTIALS_ENCRYPTION_KEYS` **aléatoires**, jamais les vraies : les colonnes chiffrées restent illisibles et rien ne peut joindre l'extérieur. `/ready` doit montrer `database` et `migrations` à vrai ; `worker` à faux est attendu. L'essai se joue sur un export postérieur à la migration 0191 : un export plus ancien ne donne aucun droit à `impera_service`, et `migrations` n'y passerait pas à vrai.
5. En fin d'essai, réussi ou non : `docker stop impera-restore-db` (le conteneur `--rm` part avec son volume anonyme), `docker network rm impera-restore-test`, suppression de l'export téléchargé et de tout fichier déchiffré. Le compte rendu ne cite aucune donnée, seulement l'empreinte, la durée et des comptes.
6. Charles saisit l'essai dans l'application (état de mise en service, EQ-17 ; `POST /v1/backups/restore-tests`) : date de fin de l'essai (le moment où les comptes de lignes ont été comparés), durée, nombre d'écarts, empreinte. Le serveur le rapproche d'un export réussi de `backup_runs` et refuse une empreinte inconnue, un essai daté d'avant cet export ou dans le futur. L'essai compte 90 jours, et seulement le dernier : un essai raté remet la garde de paie au rouge jusqu'au suivant.

Les clés gardées avec la clé privée se vérifient à part, jamais pendant l'essai : `pnpm ops:check-keys` (`deploy.md` § 4.2), en lecture seule, sans rien appeler.
