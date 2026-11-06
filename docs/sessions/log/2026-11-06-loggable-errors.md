# 2026-11-06 — Journaux sans données de fans ni de créatrices

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : coordinateur, après la relecture de #584 par Médias

## Fait

- Tout logger (API et worker) a maintenant un sérialiseur pour `err` et `error` : `loggedError` dans `apps/api/src/logger.ts`.
  - Il garde le nom de l'erreur, son message et son code. Le message est celui que garde `storableError` : la requête sans ses valeurs, suivie du SQLSTATE. Le code est le SQLSTATE ou un code réseau.
  - Il garde aussi les lignes `at` de la pile.
  - Il ne garde jamais la cause, ni le `detail` du pilote (« Key (…)=(valeur) »), ni les `params` de Drizzle, ni aucun autre champ de l'erreur.
  - Fastify garde ce sérialiseur pour les journaux des requêtes, ce qui a été vérifié.
- Graphile met le job entier dans les journaux de chaque tâche, qu'elle réussisse ou échoue, y compris sa charge utile. Or la note qu'un chatteur laisse sur un fan (`conversation.record_facts`) voyage dans cette charge utile. Les journaux ne gardent donc plus que l'id, la tâche et les tentatives du job.
- La règle est ajoutée à `docs/conventions/coding.md` (§ Logs).
- Un test unitaire, `logger.test.ts`, couvre une erreur Drizzle, un code réseau, un nom déjà réduit en chaîne, et un job Graphile réussi puis échoué.

## Reste

- Relecture Médias : `storableError` coupe maintenant `\nparams:` même sans SQLSTATE (requête coupée par le réseau, cause `ECONNRESET`), ce qui protège aussi `last_error` ; le code journalisé est cherché dans la chaîne des causes.
- Rien d’autre. Les appels qui passent déjà `error.name` restent valables : une chaîne passe telle quelle.

## Découvertes

- `graphile_worker.jobs.last_error` garde le message que `storableError` laisse passer : le même que dans les journaux. Ce message est déjà sans valeurs SQL, donc rien n'est changé là.
