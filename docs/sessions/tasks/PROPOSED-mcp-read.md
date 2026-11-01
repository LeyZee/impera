# Serveur MCP, lot 1 : accès d'agent, journal et outils de lecture du chatting
Statut : proposed
Phase : après le copilote réel (étape 5 de la feuille de route), indépendant de l'Équipe
Dépend de : ADR 0026 acceptée, EQ-01 (`withMember`, `/v1/me`), EQ-11 (Réglages par rôle)
Branche : task/<id>-mcp-read

## Objectif
Un agent externe (Claude Code, un agent Grok ou OpenAI par API) se branche sur `POST /v1/mcp` avec un jeton d'agent créé dans Réglages › Agents connectés, et lit l'état de l'agent de chatting, la file À traiter, les stats, les conversations et les fans de sa seule créatrice, chaque appel entrant au journal.

## Contexte à lire
ADR 0026 (en entier), ADR 0005, 0016, 0019, 0021, 0023, 0024 ; `docs/conventions/api.md`, `docs/conventions/security.md` §1 et §6 ; `docs/architecture/modules.md` ; `docs/architecture/threat-model.md` ; `apps/api/src/auth.ts` (`requireRole`, `requireRecentLogin`) ; `apps/api/src/modules/conversations/infra/http/routes.ts` et `apps/api/src/modules/supervision/infra/http/dashboard-routes.ts` (ce que les outils réutilisent).

## À faire
- [ ] Contrats (propriétaire de `packages/contracts`) : `mcp.ts` avec `McpCapabilitySchema` (liste fermée de l'ADR), schémas d'entrée et de sortie des outils du lot, `McpGrantSchema` sans le jeton.
- [ ] Base (propriétaire de `packages/db`) : table `mcp_grants` (personne, créatrice nullable, capacités, empreinte SHA-256 indexée du jeton, expiration, révocation, dernière utilisation), migration nouvelle ; création, liste et révocation par `withMember` en scope `owner` (`created_by = app.user_id`, comme `commission_presets`) ; une seule recherche hors RLS, `findGrantByTokenHashUnscoped` par `withAdmin`, qui ne rend que l'accès actif et non expiré. Jeton de 256 bits aléatoires au moins, jamais stocké en clair.
- [ ] Prérequis, par le propriétaire de chaque module concerné et dans sa propre PR : descendre dans `application/` la vérification d'accès qu'une route exposée porte encore dans `infra/http` (pour `conversations` : l'`actorOn` de #163 et le contrôle de créatrice des commandes), avec le même test pour la route et pour un appel direct.
- [ ] Prérequis (propriétaire de la racine de composition) : sortir d'`auth.ts` le calcul de l'acteur qu'utilise `requireRole` (`resolveActor(db, userId)`) et l'exporter ; le MCP l'appelle, il n'a aucun calcul de droits à lui.
- [ ] Module `mcp` : README, domaine pur (catalogue, capacités, intersection des droits, liste « jamais exposé »), répartiteur, transport HTTP streamable sans état (SDK `@modelcontextprotocol/sdk` épinglé, justifié dans la PR), `/v1/mcp` exempté de la vérification d'origine du dashboard (`originCheck: false`) avec sa propre règle (`Origin` absent accepté, présent dans une liste) ; entrée dans `MODULE_DEPENDENCIES`, règle « `mcp` n'importe pas `@nirvana/db` », test de frontière.
- [ ] Accès : droits recalculés à chaque appel (compte suspendu ou parti, manager plus `active`, créatrice retirée de `creatorIds` → refus) ; seul le propriétaire crée un accès ; `requireRecentLogin` pour créer, renouveler, révoquer.
- [ ] Outils : `whoami`, `creators_list`, `creator_get`, `agent_status`, `todo_list`, `stats_get`, `conversations_list`, `conversation_get`, `conversation_messages`, `drafts_pending`, `fan_get`, tous branchés sur les requêtes des `index.ts` ; messages, faits, résumé du fan et propositions dans le champ `untrusted`.
- [ ] Ressources miroirs (`nirvana://todo`, `nirvana://creators/{id}/status`) et les trois prompts de l'ADR, versionnés.
- [ ] Journal : chaque appel dans `audit_log` (`mcp.<outil>`, accès, identifiants, issue, `requestId`), sans texte ; les lectures d'agent en catégorie à part, purgée à délai avec EQ-18.
- [ ] Limites par accès (lectures), garde-fou d'exfiltration (suspension et alerte importante), interrupteur « Agents connectés ».
- [ ] Écran Réglages › Agents connectés (propriétaire d'`apps/web`) : liste, création avec le jeton montré une fois, capacités dont `read:conversation_content`, jamais cochée d'office, avec sa phrase d'avertissement (le texte part chez le fournisseur de l'agent), révocation, dernière utilisation.
- [ ] Docs : `api.md` (`/v1/mcp`, hôte à part), `security.md` §1 (l'exception), modèle de menaces (acteur « agent connecté »), glossaire si un terme manque, `modules.md`.

## Critères d'acceptation
- Test de contrat : un client MCP du SDK liste les outils, appelle chacun, reçoit les mêmes données que la route correspondante.
- Tests d'intégration (Testcontainers) : sans jeton, jeton expiré, révoqué ou d'une personne suspendue → refus ; accès sans créatrice → aucun outil de créatrice ; un membre au scope `self` ne lit par MCP que ses créatrices routées, comme par la route ; accès de la créatrice A → rien de la créatrice B ; sans `read:conversation_content` → aucun texte de fan ; chaque appel a sa ligne de journal ; la limite et le garde-fou d'exfiltration se déclenchent.
- Test d'instantané du catalogue ; test qui échoue si un outil de la liste « jamais exposé » apparaît.
- `pnpm check` et `pnpm test:all` verts.

## Hors périmètre
Écritures (lot 2), outils de l'Équipe (lot 3), OAuth et connecteurs grand public (lot 4), accès créés par une créatrice ou un chatteur.

## Notes de session
