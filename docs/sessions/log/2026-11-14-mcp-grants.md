# 2026-11-14 — MCP lot a, accès d'agent (table, jeton, routes du propriétaire)

Fiche : `PROPOSED-mcp-read` (lot a, PR 3). Branche : `claude/project-thread-b38vt4`.
Fait : contrats (`McpGrantIdSchema`, `McpGrantSchema`, `McpTokenSchema`, corps de création, refus par sorte) ; table `mcp_grants` et migration 0193 (FORCE RLS, propriétaire seul sous `withMember`, colonnes modifiables limitées à la dernière utilisation et à la révocation, déclencheur : révocation définitive, dernière utilisation qui n'avance que vers l'avant ; `GRANT SELECT … TO impera_service`, hors `WRITES`) ; règle `gitleaks` du préfixe `impmcp_` ; module `mcp` : application (créer, lister, révoquer, `grantOfToken`), magasin Drizzle, routes `/v1/settings/mcp-grants`, `index.ts`, câblage ; règle ESLint qui garde `@impera/db` hors du module sauf son magasin et son index.
Pas fait : transport `/v1/mcp`, journal des appels, outils, écran, docs d'usage (suite du lot a).
Décisions : la migration 0193 est provisoire (coordinateur) ; la révocation demande une connexion récente, comme la création (ADR 0026 § 3).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, tests unitaires du module, intégration `mcp-grants-rls`, `service-role`, `mcp-grants`.
