# 2026-11-03 — CRM-03 : garder les rapports de vérification — done
Fait :
- Chaque vérification (CRM-02) garde son rapport dans `sales_feed_checks` (migration 0071). Une ligne par vérification, jamais réécrite (trigger `refuse_change`) : jours, verdict, propre ou non, rapport tel que le propriétaire l'a vu, qui l'a lancée. L'export n'est jamais gardé.
- `isCleanMatch` (domaine) : un `match` sans bot hors de l'agent ni modèle de l'export inconnue.
- `GET /v1/settings/sales-feeds/:plateforme/check` rend le dernier rapport, ou `null`, au propriétaire seul.
Pas fait : la garde de bascule, qui attend les quatre PR de calcul d'Équipe ; `shift_feedback`.
Décisions : la propreté se calcule à l'écriture et se garde, avec une contrainte qui la réserve à un `match`. La garde lira la colonne au lieu de rejouer la règle sur un vieux rapport.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `reliability-check.test.ts` (2 tests ajoutés) ; `sales-feed-check.integration.test.ts` (rapport gardé, propre ou non, sans l'export, jamais réécrit ; `null` avant toute vérification ; 403 pour un opérateur) ; typecheck et lint ✓ ; db drift aligné.
