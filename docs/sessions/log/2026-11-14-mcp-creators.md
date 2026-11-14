# 2026-11-14 — MCP lot a, ligne de requête de `/v1/mcp` et outils des créatrices

Fiche : `PROPOSED-mcp-read` (lot a, PR 5). Branche : `claude/project-thread-b38vt4`.
Fait : sérialiseur `req` de `logger.ts` (mêmes champs que celui de Fastify) qui écrit `/v1/mcp` sans ce qui suit « ? » et garde la requête ailleurs, testé sur la sortie du journal (point 1 de la relecture Sécurité de #746) ; contrats `McpCreatorSchema`, `McpCreatorListSchema`, `McpCreatorGetSchema` ; outils `creators_list` et `creator_get` (`read:status`) par l'annuaire `creators` de `persona`, passé par le câblage à un port du domaine (`CreatorReader`) ; tests unitaires et d'intégration (accès borné, accès d'agence, archivée, autre créatrice refusée, journal).
Pas fait : autres outils de lecture, ressources et prompts, garde-fou d'exfiltration, interrupteur, écran, mode d'emploi. Test « aucun module d'express ni de hono chargé » (non bloquant, Sécurité) : pas de registre de modules en ESM, laissé de côté.
Décisions : le MCP n'importe pas `persona` ; un port, rempli par `wiring/mcp.ts`. `creators_list` sur un accès d'agence lit les créatrices de la personne lues par `resolveActor` (le manager : ses `creatorIds`, sans les créatrices routées).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, unitaires du module et de `logger`, suite d'intégration complète de l'API (148 fichiers, dont les deux qui demandent Docker). Build des images impossible dans ce conteneur (les dépôts Alpine n'y sont pas joignables) : les tests montent les routes sur le magasin partagé des limiteurs, ce qui couvre la panne de démarrage de #746.
