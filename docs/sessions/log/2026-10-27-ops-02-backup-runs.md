# 2026-10-27 — OPS-02 Sauvegarde quotidienne, lot 1 : migration 0019 (backup_runs, restore_tests) — done
Fait : migration 0019, schéma accordé par le fil Bilan. `backup_runs` (écrite par le service `backup` seul avec le rôle admin, lue par l'app ; un succès exige fin, empreinte, taille et comptes ; un échec exige sa fin ; `row_counts` est un objet ; id par défaut en base parce que psql l'écrit). `restore_tests` (essai saisi par le propriétaire, ajout seul : trigger `refuse_change`, même pour le rôle admin). Hors RLS, droits explicites (REVOKE puis GRANT). data-model.md § Système.
Pas fait : service `backup`, alerte 26 h, saisie de l'essai (lots suivants d'OPS-02).
Décisions : aucune nouvelle (ADR 0028).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : test d'intégration `packages/db/src/backup-runs.integration.test.ts` (droits de nirvana_app, CHECK, ajout seul), `pnpm check`, dérive du schéma.
