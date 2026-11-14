# 2026-11-14 — MCP lot a, les ventes relevées

Fiche : `PROPOSED-mcp-read` (lot a, PR 12). Branche : `claude/project-thread-b38vt4`.
Fait : `sales_list` (`read:sales`) par `connectors.reads.sales`, port `SalesReader` ; entrée `McpSalesInputSchema` (jours inclus, 93 au plus, `MCP_SALES_MAX_DAYS`), sortie `McpSalesListSchema` stricte, lignes additionnées sur tous les vendeurs et tous les comptes de la créatrice. `McpReadRefused` : un refus levé par la lecture d'un autre module (le câblage reconnaît `connector_reads_forbidden` et `sales_feed_team_forbidden`) sort comme un refus journalisé. Tests unitaires (somme, aucune fuite par membre, bornes, refus du module) et d'intégration.
Pas fait : `sales_by_chatter`, `commission_statements_list`, `shift_reports_list` (forme fermée à cadrer avec Sécurité) ; conversations après les lectures d'Agent ; ressources, garde-fou, écran.
Décisions : Charles, 14/11, option A : aucun montant d'argent par membre ; les ventes sortent en totaux par créatrice.
Découvertes : la borne de 93 jours vit dans `connectors/domain` (`MAX_READ_DAYS`) ; le contrat MCP la répète (`MCP_SALES_MAX_DAYS`). À rapprocher si Bilan l'exporte des contrats.
Candidats à suppression : aucun.
Vérifié : voir la PR.
