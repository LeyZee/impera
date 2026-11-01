# OPS-02 Export quotidien chiffré de la base, hors de Neon
Statut : in_progress (ID validé par Charles le 27/10/2026, 17h27)
Phase : exploitation (ADR 0028)
Dépend de : OPS-01 (fait)
Branche : task/ops-02-daily-encrypted-backup

## Objectif
Chaque nuit, un export complet de la base part chiffré chez un autre fournisseur, l'application voit s'il a réussi, et une restauration a été prouvée.

## Contexte à lire
ADR 0028, ADR 0005, ADR 0027, `docs/runbooks/restore.md`, `docs/runbooks/deploy.md`, `docs/architecture/operations.md` (§ Données), EQ-17 (qui en dépend).

## À faire
- [x] Prérequis : le rôle admin de Neon a `BYPASSRLS` (contrôle du § 1.1 de `deploy.md`) ; sans lui, `pg_dump` (qui met `row_security = off`) échoue sur les tables en `FORCE ROW LEVEL SECURITY`.
- [x] Image `backup` (`ops/db-export/Dockerfile`) : `postgres:16-alpine`, `age`, `curl` (envoi SigV4), `tzdata`, utilisateur non root, une boucle `schedule.sh` au lieu de `supercronic` (crond exige root), dump avec les droits, sommes de contrôle à l'envoi (ADR 0029) ; l'heure de Paris par `TZ=Europe/Paris` dans la boucle ; script d'export (dump `custom` sans les données de `session`, `verification` et `rate_limit_counters`, relecture `pg_restore --list`, comptes de lignes, chiffrement `age`, envoi, ligne `backup_runs`).
- [x] Service `backup` dans `docker-compose.prod.yml` ; variables dans `.env.example` sans valeur.
- [x] Migration `backup_runs` (écrite avec le fil propriétaire de `packages/db`, prochaine migration libre) : `GRANT SELECT` à `nirvana_app`, écriture par le rôle admin seul, pas de RLS.
- [x] Job `images` de la CI : construire l'image, puis, dans une étape à part (bornée à 10 min), export vers un dossier local sur la base de test, `pg_restore` dans une base vide et comparaison des comptes.
- [x] `restore.md` § B et test trimestriel réécrits selon l'ADR ; `deploy.md` : création du bucket (versioning, verrou d'objets, cycle de vie 30 jours, identifiants sans suppression), génération de la paire `age` sur le PC de Charles, garde des clés de l'application avec la clé privée.
- [x] Script d'essai de restauration pour la session Remote Control du PC de Charles : conteneur Postgres jetable sans volume, restauration sans les clés de chiffrement de l'application, file `graphile_worker` vidée juste après `pg_restore`, API seule (jamais le worker), comparaison des comptes, suppression du conteneur et du dump déchiffré en fin d'essai (même en échec), empreinte SHA-256 de l'export affichée pour la saisie du propriétaire (EQ-17).
- [x] Alerte des 26 h côté serveur : module `backups`, `GET /v1/backups/status` (propriétaire), job horaire `backups.check` qui publie `backup_overdue` (sans créatrice, une fois par jour), message Telegram « important » ; la bannière ambre du Dashboard revient au fil Dashboard.
- [x] Script en lecture seule qui prouve que les clés de l'application gardées avec la clé privée déchiffrent les données, sans rien appeler : `pnpm ops:check-keys` (`deploy.md` § 4.2), connexion que la base garde en lecture seule, clés tapées sans écho.
- [x] Saisie de l'essai côté serveur : `POST /v1/backups/restore-tests` (propriétaire, connexion récente, `id` client pour l'idempotence, rapprochement par empreinte d'un export réussi), `lastRestoreTest` et `restoreTestFresh` dans l'état, `restoreTestFresh(at)` pour la garde de paie d'EQ-17 (port branché par le composition root). L'écran de saisie est à EQ-17.
- [ ] Premier essai joué, saisi par le propriétaire dans l'état de mise en service (EQ-17), rapproché d'une ligne réussie de `backup_runs`.

## Critères d'acceptation
- La CI prouve la chaîne export → restauration → mêmes comptes de lignes à chaque PR.
- Un dump illisible ou une version de `pg_dump` incompatible donne un échec enregistré, jamais un succès.
- Le serveur ne peut pas déchiffrer un export (pas de clé privée dans Coolify ni dans le dépôt).
- Une restauration réelle a été jouée une fois, avec sa durée ; après l'essai, ni conteneur ni dump déchiffré ne restent sur le PC.
- Le PC de Charles ne détient aucun identifiant de la base de production.
- Pendant l'essai, rien ne peut partir : pas de clé de chiffrement de l'application, file vidée, aucun worker.
- Un script en lecture seule prouve que les clés gardées avec la clé privée ouvrent encore une ligne, sans rien appeler.

## Hors périmètre
L'avertissement du Dashboard, la saisie de l'essai de restauration et la garde de paie (EQ-17) ; l'archive annuelle des factures (EQ-17) ; les médias.

## Notes de session
