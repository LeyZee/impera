# 2026-11-14 — MCP lot a, PR 2 : les règles pures du module `mcp` — done
Fait : `packages/contracts/src/mcp.ts` (capacités de 0026 et 0105, capacités réservées au propriétaire, champ `untrusted`) ; `apps/api/src/modules/mcp/domain/` : catalogue de lecture du lot a figé par instantané, `decideCall` (second facteur, capacité, propriétaire seul, créatrice de l'accès, personne relue), `grantProblems`, liste « jamais exposé » en motifs testée ; README ; entrée `mcp` dans `MODULE_DEPENDENCIES`.
Pas fait : accès d'agent, migration, transport, journal, branchement des outils, écran (attendent ADR 0087, #716).
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, tests unitaires du module.
