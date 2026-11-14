# 2026-11-14 — MCP lot a, la consommation IA au propriétaire

Fiche : `PROPOSED-mcp-read` (lot a, PR 9). Branche : `claude/project-thread-b38vt4`.
Fait : drapeau `ownerOnly` du catalogue, appliqué par `decideCall` (autre rôle : `owner_only` ; accès borné à une créatrice : `creator_forbidden`) et par `tools/list` (caché sur un accès borné) ; `ai_usage_get` le porte. Contrat `McpAiUsageSchema` (strict) ; outil par `ai-usage` (`read`), passé par le câblage à un port du domaine (`AiUsageReader`) ; `wireAiUsage` passe avant `wireMcp` dans la racine ; tests unitaires (règle, champs fermés) et d'intégration (accès d'agence, accès borné).
Pas fait : `shifts_list` et `team_import_list` (suivants, sans montant par membre) ; outils d'argent par membre en attente de Charles ; conversations après les lectures d'Agent ; ressources, garde-fou, écran.
Décisions : la consommation IA est un chiffre de l'agence ; un accès borné à une créatrice (son agent) ne la lit pas, même au nom du propriétaire.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : voir la PR.
