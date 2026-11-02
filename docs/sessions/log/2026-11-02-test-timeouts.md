# 2026-11-02 — Délais des tests unitaires (pre-push) — done
Fait : `findBy…`/`waitFor` du dashboard attendent 5 s au lieu de 1 s (`apps/web/src/test/setup.ts`), et les tests unitaires de `apps/web` et `apps/api` ont 20 s au lieu de 5 s. Sur le PC de Charles, le pre-push échouait sur des tests justes (délais dépassés, « Voir le shift » de PlanningPage) parce que les deux suites tournent ensemble. Aucune assertion n'est changée.
Pas fait : rien dans le hook pre-push, qui lance toujours `pnpm check` puis `pnpm test`.
Décisions : aucune.
Découvertes : `screens/train/playground/demo.test.ts` prend 3,6 s à lui seul ; à alléger par le fil Agent s'il redevient lent.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓ ; web 1088/1088 et api 1076/1076, seuls puis ensemble sur deux cœurs (`taskset -c 0,1`).
