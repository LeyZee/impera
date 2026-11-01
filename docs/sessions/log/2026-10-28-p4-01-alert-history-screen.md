# 2026-10-28 — P4-01 Historique des alertes du Suivi (PR C2) — in_progress
Fait :
- `apps/web/src/screens/tracking/history/` : `model.ts` (pages de plusieurs créatrices fusionnées en une liste sans rien sauter, cibles de « Tout marquer comme vu », moment lu « il y a 5 min » puis « hier à 9 h », choix du filtre d'alerte), `api.ts` (`/v1/alerts/triggers` lu par le contrat, refus rangés par `ALERT_HISTORY_ERROR_CODES`, relu toutes les 30 s), `AlertHistoryPage.tsx` et `history.css`.
- Suivi : sous-vues « Conversations » et « Historique des alertes » (`SuiviNav.tsx`), adresse `/suivi/alertes`, le chatteur renvoyé sur `/suivi`. `SubNav` allume une sous-vue à l'adresse exacte, sans la recherche.
- `useAlerts` de Réglages › Alertes prend `enabled` (lu seulement par le propriétaire, pour nommer ses alertes dans le filtre).
- Tests : `model.test.ts`, `AlertHistoryPage.test.tsx`, trois cas de plus dans `AppShell.test.tsx` (sous-vue allumée seule, chatteur et créatrice renvoyés). Captures 1 440 et 400 px, Nuit et Jour.
Pas fait : « Tester » dans Réglages › Alertes (PR suivante).
Décisions : aucune.
Découvertes : aucune.
