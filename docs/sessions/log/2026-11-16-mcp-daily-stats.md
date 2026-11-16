# 2026-11-16 — MCP lot a, les statistiques quotidiennes de la plateforme

Fiche : `PROPOSED-mcp-read` (lot a, PR 14). Branche : `claude/project-thread-b38vt4`.
Fait : `platform_daily_stats_list` (`read:status`, portée d'une créatrice au catalogue) par `connectors.reads.dailyStats`, ajouté au port `SalesReader` ; entrée `McpDailyStatsInputSchema` (celle de `sales_list`), sortie `McpDailyStatsListSchema` stricte, chaque compteur recopié à la main. Tests unitaires (lecture comme la personne, compteurs inconnus à `null`, rien d'autre ne sort) et de transport (accès borné, période trop longue, autre créatrice refusée, accès de l'agence refusé en `creator_required`).
Pas fait : `stats_get`, puis `sales_by_chatter` en compteurs ; conversations après les lectures d'Agent ; ressources, garde-fou, écran.
Décisions : aucune nouvelle ; la portée d'une créatrice vient du catalogue (ADR 0105 § 4).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : voir la PR.
