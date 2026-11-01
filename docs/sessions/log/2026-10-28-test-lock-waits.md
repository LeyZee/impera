# 2026-10-28 — Tests : compter les attentes de verrou de sa seule base — done
Fait :
- `apps/api/src/__tests__/support/lock-waits.ts` : `lockWaits(db, kind)` compte les verrous attendus par les sessions connectées à la base du test (`pg_locks` filtré par `pid` sur `pg_stat_activity`, où `datname = current_database()`), consultatifs par défaut ou de toute sorte. Le filtre par session vaut aussi pour une attente de ligne (`transactionid`), qui n'a pas de base dans `pg_locks` (relecture de Bilan sur #270).
- Les tests du planning qui attendent un verrou (`scheduling`, `scheduling-reports`, `scheduling-leaves-swaps`) l'utilisent au lieu de leur propre requête.

Pas fait : les tests de la paie qui attendent un verrou (`support/payroll-team.ts`, `payroll.integration.test.ts`) passent à `lockWaits` avec leur lot, qui n'est pas encore dans `main`.

Décisions : une PR à part, puisque le fichier de support est partagé (Bilan, 28/10).

Découvertes : `pg_locks` montre les attentes de toutes les bases. Les fichiers de test tournent côte à côte, chacun sur sa base ; deux workers simultanés du test des taux de change (alerte `exchange_rate_overdue`) faisaient échouer, sous charge, des tests de la paie qui veulent exactement une ou deux attentes.

Candidats à suppression : aucun.

Vérifié : `pnpm check` ✓ sur `main` après #259 ; typecheck et lint de l'API ✓ ; intégration du planning ✓ (3 fichiers, 55 tests) ; sur la pile de la paie, intégration de l'API ✓ deux passages de suite (348).
