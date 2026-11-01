# 2026-10-28 — Alertes de l'agence : la recherche du doublon du jour bornée à deux jours — done
Fait : `backup_overdue` (`backups/infra/postgres.ts`) et `budget_threshold_crossed` (`apps/api/src/budget-events.ts`) cherchaient l'alerte du jour dans toute la table `domain_events`, sans index sur `type` : un parcours complet à chaque contrôle, qui grossit avec les événements des conversations. La recherche ne regarde plus que les deux derniers jours (`created_at`, servi par `domain_events_created_idx`), comme `exchange_rate_overdue` (#276). La règle « une alerte par jour » ne change pas : la ligne du jour a moins de deux jours.
Pas fait : rien.
Décisions : aucune.
Découvertes : aucune (relevé par Bilan sur #276, en Découvertes d'Équipe).
Candidats à suppression : aucun.
Vérifié : `budget-events.integration.test.ts` et `backups.integration.test.ts` ✓ (7) ; `pnpm check` et `pnpm test` au push.
