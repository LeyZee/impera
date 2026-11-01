# 0028. Export quotidien chiffré de la base, hors de Neon

Statut : accepted (Charles, 27/10 17h27) ; § 1 outils et § 2 `--no-privileges` remplacés par l’ADR 0029
Date : 2026-10-27

## Contexte

La base de production est Neon (ADR 0005), avec son retour dans le temps (PITR, 7 jours au moins). `docs/architecture/operations.md` et `docs/runbooks/restore.md` § B promettent en plus un export logique quotidien, chiffré, hors de Neon, gardé 30 jours. Cet export n'existe pas : aucun job, aucun conteneur, aucun secret prévu. Le PITR ne protège ni contre la perte du compte Neon (compte compromis, facture impayée, projet supprimé), ni contre une erreur découverte après 7 jours.

La paie rend ce trou inacceptable (EQ-17) : relevés, factures et taux datés ne se reconstituent pas. Imperium s'est arrêté sans sauvegarde et son historique est perdu.

## Décision

**1. Un service `backup` dans `docker-compose.prod.yml`**, sur une image dédiée `postgres:16-alpine` + `age` + `rclone`, qui tourne en continu et lance l'export chaque nuit à 3 h (heure de Paris) avec `supercronic`. L'export ne passe pas par l'API ni par le worker : un dump de plusieurs minutes ne tient pas dans un job Graphile, et l'outil doit savoir restaurer sans le code de Nirvana. Le client `pg_dump` suit la version majeure de Neon ; si Neon passe à une version plus récente, le dump échoue bruyamment (alerte ci-dessous) au lieu de produire un fichier faux.

**2. Le dump est complet et autonome** : `pg_dump --format=custom --no-owner --no-privileges` avec le rôle admin, sur l'endpoint direct. Il contient le schéma, les données de tous les schémas (dont `graphile_worker` et la table des migrations), sauf celles de trois tables qui n'ont rien à faire dans une copie de 30 jours (`--exclude-table-data`) : `session` (jetons de session au porteur ; une restauration déconnecte tout le monde, c'est voulu), `verification` et `rate_limit_counters` (jetable). Il se restaure avec `pg_restore` dans une base vide, sans rejouer les migrations. Avant de chiffrer, le job relit le fichier (`pg_restore --list`) et compte les lignes des tables métier : un dump illisible ne part jamais comme une sauvegarde réussie. Cela remplace le `--data-only` de `restore.md` § B.

**3. Chiffrement par `age` avec une clé publique.** Le serveur ne détient que la clé publique (`BACKUP_AGE_RECIPIENT`) : il chiffre, il ne sait pas déchiffrer. La clé privée vit hors du serveur, en deux exemplaires choisis par Charles (gestionnaire de mots de passe et copie papier). Un serveur compromis ne donne donc pas accès aux sauvegardes.

**4. Stockage chez un autre fournisseur que Neon** : un bucket Hetzner Object Storage (Europe, compatible S3). Neon tourne chez AWS : une panne ou une fermeture de compte d'un côté ne touche pas l'autre. Le bucket a le versioning et un verrou d'objets (Object Lock, mode gouvernance, 30 jours). Les identifiants du service `backup` peuvent écrire, mais ni lister l'historique ni supprimer. Une règle de cycle de vie efface les exports de plus de 30 jours. Les exports annuels de factures (EQ-17, dix ans) vont dans un **autre bucket**, avec son propre verrou (dix ans) et ses propres identifiants : une règle de cycle de vie de 30 jours ne peut pas les toucher par erreur.

**5. Chaque export laisse une trace lisible par l'application** : une ligne dans `backup_runs` (début, fin, statut, taille, empreinte SHA-256 du fichier chiffré, nombre de lignes par table métier, version de `pg_dump`), écrite avec le rôle admin. L'application lit cette table, jamais un fichier du serveur. Plus de 26 h sans export réussi : avertissement ambre sur le Dashboard du propriétaire, et alerte Telegram (ADR 0020). La table et l'avertissement font partie d'EQ-17.

**6. Une sauvegarde non testée n'existe pas.** Une fois par trimestre, la restauration est jouée sur le PC de Charles, où se trouve la clé privée, par une session Remote Control : Charles approuve, il ne tape aucune commande. La session télécharge le dernier export, le déchiffre et le restaure dans un conteneur Postgres **jetable**, sans volume, séparé du Postgres de développement. **Rien ne doit pouvoir partir pendant l'essai** : la copie contient la file `graphile_worker`, les comptes de plateforme avec leur `connector_config.writes`, le bot Telegram et les clés des services. L'essai se fait donc **sans** `SESSION_ENCRYPTION_KEYS` ni `CREDENTIALS_ENCRYPTION_KEYS` (les colonnes chiffrées restent illisibles, rien ne peut joindre l'extérieur), la file `graphile_worker` (jobs et tâches planifiées) est vidée juste après `pg_restore`, et seule l'API démarre, jamais le worker : `/ready` doit montrer la base et les migrations à vrai, le worker absent est attendu. La session compare ensuite les comptes de lignes à ceux de l'export. En fin d'essai, réussi ou non, elle supprime le conteneur et le dump déchiffré. Le PC n'a aucun identifiant de la base de production : le résultat ne s'écrit donc pas dans `backup_runs`. Le propriétaire le saisit dans l'état de mise en service d'EQ-17 : date, durée, écarts et empreinte SHA-256 de l'export restauré. Le serveur rapproche cette empreinte d'une ligne réussie de `backup_runs` et refuse un essai qui ne correspond à aucun export. EQ-17 exige un essai de moins de trois mois avant toute paie réelle.

**7. Les clés de chiffrement de l'application ne sont pas dans le dump.** Les sessions plateforme et les clés des services IA y sont chiffrées par `SESSION_ENCRYPTION_KEYS` et `CREDENTIALS_ENCRYPTION_KEYS`. Une restauration sans ces clés rend ces colonnes illisibles. Les clés sont donc gardées avec la clé privée `age`, et chaque rotation (`rotate-secrets.md`) met cette copie à jour. Elles servent à une vraie restauration après sinistre, jamais à l'essai trimestriel. Qu'elles ouvrent encore les données se prouve à part, par un script en lecture seule qui déchiffre une ligne et n'appelle rien.

## Conséquences

- Un cinquième service dans le compose, trois variables de plus (`BACKUP_AGE_RECIPIENT`, identifiants et nom du bucket), documentées dans `.env.example` sans valeur.
- `restore.md` § B change : `pg_restore` d'un dump complet au lieu de migrations puis `--data-only` ; le test trimestriel suit le § 6.
- Coût : quelques centimes par mois pour 30 exports de quelques dizaines de Mo.
- Le job `images` de la CI construit aussi l'image `backup` et lance un export vers un dossier local (sans bucket) sur la base de test, suivi d'un `pg_restore` dans une base vide : la chaîne est vérifiée à chaque PR, sauf l'envoi.
- Les médias (quand ils seront stockés chez nous) relèvent d'une autre décision : un bucket versionné, sans dump.

## Alternatives rejetées

- **Se reposer sur le PITR de Neon seul** : ne couvre ni la perte du compte, ni plus de 7 jours.
- **Branches ou snapshots Neon** : restent chez Neon, même compte, même risque.
- **Dump `--data-only` après migrations** (ce que décrivait `restore.md`) : dépend du code de la bonne version au moment de restaurer, et oublie le schéma `graphile_worker`.
- **Export lancé par le worker (job Graphile)** : un dump long bloquerait la file, le worker aurait besoin d'outils Postgres dans son image, et une sauvegarde dépendrait de l'application qu'elle doit protéger.
- **Chiffrement symétrique (mot de passe sur le serveur)** : un serveur compromis lirait toutes les sauvegardes.
- **Cloudflare R2** : convient aussi ; Hetzner est retenu parce que le VPS y est déjà (une facture, une région), sans dépendre de Neon. À reconsidérer si le compte Hetzner devient lui-même un point unique (le VPS et les sauvegardes y seraient tous les deux).
