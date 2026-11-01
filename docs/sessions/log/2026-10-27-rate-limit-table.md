# 2026-10-27 — Migration 0017 : la table du limiteur partagé — done
Fait : `rate_limit_counters` (`packages/db/src/schema/system.ts`, migration 0017) au schéma demandé par le fil Mise en production (OPS-01, lot 2) : `key` haché en clé primaire (≤ 512 caractères), `hits` > 0, `window_ends_at` indexé. Table UNLOGGED écrite à la main dans la migration, hors RLS comme `worker_heartbeats`, avec un `GRANT` explicite à `nirvana_app` (les privilèges par défaut d’init.sql n’existent ni dans les bases de test ni sur Neon). `data-model.md` la décrit.
Pas fait : le store, la tâche `rate_limit.purge` et leur branchement (lot 2 du fil Mise en production).
Décisions : UNLOGGED accepté : perdre les compteurs à un crash n’ouvre qu’une fenêtre neuve. La purge borne à une heure la conservation des clés, qui sont hachées.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓ (dérive du schéma nulle), pnpm test ✓ ; intégration `packages/db` (44 tests, dont `rate-limit.integration.test.ts` : table UNLOGGED, l’upsert atomique du store compte puis repart à 1, les deux CHECK refusent).
