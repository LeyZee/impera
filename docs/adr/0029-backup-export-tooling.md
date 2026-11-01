# 0029. L'export garde les droits de la base, et s'outille sans binaire hors d'Alpine

Statut : accepted (Charles, 27/10 17h56, carte « J’accepte l’ADR 0029 »)
Date : 2026-10-27
Remplace : dans l'ADR 0028, le drapeau `--no-privileges` du § 2, et au § 1 `rclone` et `supercronic`

## Contexte

En écrivant le service `backup` (OPS-02, #187), trois points de l'ADR 0028 se sont révélés faux ou inutiles.

- `--no-privileges` retire du dump les `GRANT` que les migrations donnent à `nirvana_app`, table par table. Une base restaurée avec ce dump refuse alors tout au rôle de l'application : l'API démarre, puis chaque requête échoue. Il faudrait rejouer les droits à la main, au pire moment, sans liste fiable.
- `rclone` et `supercronic` sont deux binaires de plus à suivre hors des paquets Alpine, alors que `curl` (signature AWS SigV4 intégrée) et une boucle de shell font le même travail.
- Un bucket avec verrou d'objets refuse un envoi sans somme de contrôle.

## Décision

1. **Le dump garde les droits** : `pg_dump --format=custom --no-owner`, sans `--no-privileges`. `--no-owner` reste, à l'export comme à la restauration : la base restaurée appartient au rôle qui restaure. Pour restaurer, le rôle `nirvana_app` doit exister ; l'essai trimestriel le crée sans connexion possible (`NOLOGIN`), une vraie restauration le crée comme au déploiement (`deploy.md` § 1.1). Le reste du § 2 ne change pas.
2. **L'envoi se fait avec `curl --aws-sigv4`**, les identifiants passés par l'entrée standard, jamais sur la ligne de commande. Chaque envoi porte `x-amz-checksum-sha256` (et `Content-MD5` pour un fournisseur qui le demande encore), signés avec la requête : le bucket vérifie le fichier reçu et refuse un envoi abîmé.
3. **La planification est une boucle** (`schedule.sh`) : elle lance l'export à `BACKUP_AT` (3 h par défaut) au fuseau `BACKUP_TZ` (Paris par défaut). Un conteneur arrêté à cette heure exporte à son redémarrage, sauf si l'export du jour a déjà réussi.

L'image reste `postgres:16-alpine` (version épinglée), plus `age`, `curl` et `tzdata`, tous trois des paquets Alpine.

## Conséquences

- Une restauration ne demande aucun `GRANT` à la main : le rôle `nirvana_app` existe, et la base restaurée lui donne exactement les droits des migrations.
- Les droits du dump nomment `nirvana_app` : restaurer sur un serveur sans ce rôle échoue, ce que `restore.md` dit avant la commande.
- Rien ne change pour `backup_runs`, le chiffrement, le bucket ni l'essai trimestriel.
- L'ADR 0028 passe en « accepted (§ 1 outils et § 2 `--no-privileges` remplacés par 0029) ».

## Alternatives rejetées

- **Garder `--no-privileges` et rejouer les droits après la restauration** : il faudrait une liste des droits tenue à jour hors des migrations, et la relire sous la pression d'un sinistre.
- **Rejouer toutes les migrations dans une base vide, puis charger les données seules** : c'est le `--data-only` que l'ADR 0028 a remplacé, parce qu'il dépend du code de Nirvana au moment de restaurer.
