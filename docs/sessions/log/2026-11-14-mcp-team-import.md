# 2026-11-14 — MCP lot a, l'équipe importée

Fiche : `PROPOSED-mcp-read` (lot a, PR 11). Branche : `claude/project-thread-b38vt4`.
Fait : drapeau `agencyOnly` du catalogue (`team_import_list`, `commission_statements_list`), appliqué par `decideCall` (`creator_forbidden` sur un accès borné) et par `tools/list` ; l'instantané du catalogue montre `owner-only` et `agency-only`. `team_import_list` (`read:team`) par `connectors.reads.teamImport`, port `TeamImportReader` ; entrée `McpTeamImportInputSchema` (plateforme, Reveal par défaut), sortie `McpTeamImportListSchema` stricte sans identifiant de compte de plateforme. Tests unitaires et d'intégration.
Pas fait : outils d'argent sous la forme fermée de l'option A ; conversations après les lectures d'Agent ; ressources, garde-fou, écran.
Décisions : l'identifiant d'un compte de chatteur côté plateforme ne sort pas (consigne du coordinateur : seulement si un outil en a besoin) ; un compte se lit par son lien (membre ou agent).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : voir la PR.
