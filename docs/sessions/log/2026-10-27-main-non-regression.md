# 2026-10-27 — Passe de non-régression sur main (5a3e09d) — done
Fait : sur main à jour (#207 comprise), `pnpm check`, `pnpm test` (980 tests) et `pnpm test:integration` (db 66, api 200) sont verts. Les migrations 0000 à 0021 ont été rejouées sur une base vierge, puis une seconde fois sans effet (22 entrées dans le journal Drizzle, aucune dérive). Chaque nom de `JOB_NAMES` a sa charge et son nombre d'essais, et une tâche dans la composition root, sauf `fans.refresh_summary` et `media.describe`, déjà documentés comme sans tâche dans `operations.md`. Chaque fichier des contrats est exporté par l'index. Sur la base vierge, les 17 tables sans RLS sont toutes voulues ; `data-model.md` en oubliait quatre familles dans sa liste « Hors RLS », corrigée ici.
Pas fait : rien.
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test, pnpm test:integration, migrations rejouées deux fois sur base vierge.
