# 2026-11-06 · VEI-01 d3 : l'idée passe à « déposée » quand son dépôt arrive

- Fil : Bilan. Branche `claude/project-thread-a8l1w6`.
- Fait : quand un dépôt qui répond à une demande de contenu n'attend plus aucun octet, `follow` (`content-drops`) met en file le job `content_drops.drop_received` (`{creatorId, dropId, requestId}`, clé `content_drops.drop_received:<dropId>`), dans la transaction qui écrit `content_drop_received`. Le job est câblé chez `trends` (`wiring/trends.ts`, `followDeposit`) : l'idée de la créatrice dont la demande porte l'identifiant passe de `suggested` à `deposited`. Sans migration.
- Tests : unitaire `follow.test.ts` ; intégration `trend-ideas` (idée déposée une fois, rejouée sans effet, dépôt d'une autre créatrice sans effet) et `content-drop-uploads` (annonce faite une fois pour un dépôt qui répond à une demande, aucune sans demande ; minio en local).
- Décisions : un job annoncé dans la transaction, comme `creator_tasks.suggestion_decided` en d2, plutôt qu'une lecture de `domain_events` par la veille ; l'événement reste pour l'historique.
- Découvertes : aucune.
