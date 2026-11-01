# Module `backups`

**Rôle.** Ce que l'application sait de l'export quotidien chiffré de la base (ADR 0028 § 5, OPS-02) : l'état des sauvegardes pour le Dashboard du propriétaire, et l'alerte quand un export manque depuis 26 h. L'export lui-même tourne hors de l'application, dans le service `backup` (`ops/db-export/`).

**Peut dépendre de.** aucun module métier (feuille).

**Tables.** Lit `backup_runs` avec le rôle de l'application (`SELECT` seul, hors RLS : aucune donnée de créatrice), chaque ligne passée par Zod parce qu'un script l'écrit. N'écrit jamais `backup_runs`. Écrit dans `domain_events` l'événement `backup_overdue`, sans créatrice, avec le rôle admin (comme `budget_threshold_crossed`).

**Règles propres** (`domain/status.ts`, testées) :

- `ok` si un export a réussi dans les 26 dernières heures, `overdue` au-delà, `never` si aucun n'a jamais réussi ;
- l'alerte Telegram part pour `overdue` ; pour `never`, seulement si la plus ancienne ligne de `backup_runs` a plus de 26 h (juste après une mise en service, avant la première nuit, pas de bruit) ; sans aucune ligne (le service n'a jamais tourné), seulement l'ambre du Dashboard ;
- un `running` de plus de 26 h n'est pas un succès ;
- au plus une alerte par jour, à l'heure de Paris, tant que ça dure : elle revient chaque matin jusqu'au prochain export réussi.

**Routes** (montées sous `/v1`, contrat `packages/contracts/src/backups.ts`, propriétaire seul) :

- `GET /backups/status` : l'état de l'export, le dernier essai de restauration (avec la fin de l'export qu'il a restauré) et sa fraîcheur. La réponse ne donne ni le chemin du fichier, ni le bucket, ni l'empreinte d'un export.
- `POST /backups/restore-tests`, après une connexion de moins de 10 minutes : l'essai trimestriel saisi par le propriétaire (ADR 0028 § 6). L'empreinte doit nommer un export `succeeded` (422 `restore_test_backup_unprocessable`), l'essai ne peut précéder la fin de cet export (422 `restore_test_before_backup_unprocessable`) ni dépasser l'horloge du serveur de plus de 5 minutes (422 `restore_test_in_future_unprocessable`). L'`id` vient du client : le même essai renvoyé donne la ligne existante (200), le même `id` avec d'autres valeurs un 409 `restore_test_conflict`. Une ligne `restore_test.record` entre dans `audit_log`, sans les notes.

**Pour EQ-17.** `restoreTestFresh(at)`, exporté par l'index et branché par le composition root sur le port de la garde de paie (`at` = l'instant de l'action gardée, jamais une date passée) : vrai si le **dernier** essai (par date d'essai) n'a trouvé aucun écart et a au plus `RESTORE_TEST_FRESH_DAYS` (90) jours. Un essai récent raté veut dire que la restauration est cassée maintenant.

**Tables (suite).** Lit et ajoute `restore_tests` avec le rôle de l'application (`SELECT`, `INSERT` ; ni modification ni suppression : droits et trigger de la migration 0019).

**Job.** `backups.check`, toutes les heures (`crontab.ts`). Le message Telegram vient du module `telegram` (sujet « important »).

## Structure

- `domain/` : la règle des 26 h, le jour de Paris, les ports. Zéro I/O.
- `application/` : l'état pour la route, le contrôle pour le job.
- `infra/` : lecture Drizzle, publication de l'événement, route Fastify.
- `index.ts` : **seule** porte d'entrée publique du module.

Voir `docs/architecture/modules.md` pour les règles communes.
