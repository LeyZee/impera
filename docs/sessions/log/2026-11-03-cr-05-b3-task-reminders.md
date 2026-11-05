# 2026-11-03 — Agenda de la créatrice : les rappels de ses tâches sonnent (CR-05, lot b3) — in-progress

Fait :

- Job `creator_tasks.remind` (contrats : nom, charge `{ taskId, startsAt }`, 3 essais), mis en file par `POST` et `PATCH /v1/creator-space/tasks` dans la même transaction, sous la clé `creator_tasks.remind:<taskId>` en mode `replace`, à son début moins ses minutes. Un déplacement remet le même job à la nouvelle heure.
- Le job relit la tâche et ses comptes par le rôle admin (`reminder-source.ts`), puis prévient chacun par le `notify` du module `notifications` (raison `reminder`, objet `task:<id>:<début>`). Un job resté d'avant un déplacement, une tâche retirée ou déjà commencée ne sonnent rien ; un job rejoué ne sonne pas deux fois.
- Message : son titre, « Dans 15 min · 14 h – 16 h » dans son fuseau, qui ouvre son jour (`/agenda?jour=`). Jamais un fan, un chatteur ni un montant.
- `notifications` est câblé avant `creator-tasks` dans le composition root, qui expose maintenant `modules.creatorTasks`.
  Pas fait : lot c (écran agence, iCal, couche des shifts). Une tâche acceptée depuis une suggestion n'a pas de rappel (la colonne reste vide, comme avant).
  Décisions :
- Pas de table nouvelle ni de migration : la clé du job suffit à le déplacer, et `notification_deliveries` garde la décision une fois.
- Rien ne sonne une fois la tâche commencée, même si le job a pris du retard (le worker arrêté) : son agenda le montre déjà.
  Découvertes : la variable des tests d'intégration sans Docker s'appelle maintenant `IMPERA_TEST_PG_URL` (renommage, ADR 0062).
  Candidats à suppression : aucun.
  Vérifié :
- `reminder.test.ts` (5 tests : instant, message, tâche déplacée, retirée ou commencée, retard du job, heures en français) ;
- `creator-reminders.integration.test.ts` (2 tests : job programmé puis déplacé avec la tâche, ancien job muet, une seule sonnerie ; tâche retirée muette, pas de job sans rappel) ; `creator-agenda.integration.test.ts` toujours vert ;
- `architecture.test.ts` (le job a sa tâche, une fois) et `jobs.test.ts`.
