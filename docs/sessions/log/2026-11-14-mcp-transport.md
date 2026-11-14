# 2026-11-14 — MCP lot a, porte `/v1/mcp`, répartiteur, journal et `whoami`

Fiche : `PROPOSED-mcp-read` (lot a, PR 4). Branche : `claude/project-thread-b38vt4`.
Fait : SDK `@modelcontextprotocol/sdk` 1.32.2 épinglé (dépendances en quarantaine fixées par `overrides`) ; transport `POST /v1/mcp` sans état sur le transport du SDK aux standards du Web (aucun serveur Express ni Hono ne tourne) ; porte : `Bearer` seul, forme du jeton avant empreinte, URL à paramètre refusée, cookie ignoré, personne relue par `resolveActor`, un 401 unique compté par adresse (10/min puis 429) ; règle d'`Origin` de 0026 § 2 (liste vide) ; 405 sur `GET` et `DELETE` ; répartiteur (catalogue servi, arguments stricts, `decideCall`, 60 lectures/min par accès) ; journal `mcp.<outil>` sous `withMember` avant toute réponse ; `whoami` ; contrats `McpCallRefusalSchema`, `McpWhoamiSchema` ; exception notée dans `api.md`.
Pas fait : autres outils de lecture (un module à la fois), ressources et prompts, garde-fou d'exfiltration, interrupteur « Agents connectés », écran, mode d'emploi Claude Code.
Décisions : `tools/list` ne montre que les outils servis dont l'accès a la capacité ; un nom hors catalogue s'écrit `mcp.tool_unknown`, jamais recopié ; la personne est lue une fois par requête HTTP.
Découvertes : `hono` 4.13.16 et `@hono/node-server` 2.1.6 corrigent des avis modérés et sortent de quarantaine vers le 16/11 ; à monter alors (le transport ne les exécute pas).
Candidats à suppression : aucun.
Vérifié : `pnpm check`, tests unitaires du module, intégration `mcp-transport` (client du SDK compris) et `mcp-grants`.
