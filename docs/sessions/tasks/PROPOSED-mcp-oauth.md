# Serveur MCP, lot c : OAuth 2.1 pour ChatGPT, Claude.ai et les agents des créatrices
Statut : proposed
Phase : après le déploiement (étape 7 de la feuille de route)
Dépend de : lot a du MCP (`PROPOSED-mcp-read`), déploiement, hôte MCP publié ; EQ-09 pour les accès créés par une créatrice
Branche : task/<id>-mcp-oauth

## Objectif
Un connecteur grand public (ChatGPT, Claude.ai) se branche sur Impera par OAuth 2.1 : la personne se connecte, choisit la créatrice et les capacités, et l'accès créé est le même `mcp_grant` qu'avec un jeton d'agent.

## Contexte à lire
ADR 0026 §2 et §3, ADR 0105 ; spécification MCP (autorisation) à sa version du moment ; RFC 9728 ; `apps/api/src/auth.ts` ; `docs/conventions/security.md` §1 et §6.

## À faire
- [ ] Décision écrite avant de coder : greffon de Better Auth ou serveur d'autorisation à part, enregistrement dynamique des clients ou liste blanche ; ADR si cela engage plus que ce module.
- [ ] Code d'autorisation avec PKCE, métadonnées de ressource protégée, page de consentement (créatrice, capacités, expiration), jetons courts et renouvelables liés à l'accès.
- [ ] Publication du seul hôte MCP par Traefik ; tout le reste y répond 404.
- [ ] Accès créé par une créatrice pour elle-même, limité à ce que l'ADR 0023 lui ouvre.
- [ ] Le consentement ne coche jamais d'office une capacité ; `prepare:team` et `read:script_content` ne s'y proposent que sur un accès du propriétaire (ADR 0105).

## Critères d'acceptation
- Un client OAuth de test obtient un jeton, appelle `whoami`, et le révoquer depuis le CRM coupe l'appel suivant.
- Tests : consentement refusé, PKCE faux, redirection non enregistrée → refus.
- `pnpm check` et `pnpm test:all` verts.

## Hors périmètre
Nouveaux outils.

## Notes de session
