# MCP-UI L'écran Réglages › Agents connectés
Statut : in-progress
Phase : MCP (ADR 0026 § 3, ADR 0105 § 1), lot a
Dépend de : les routes `/v1/settings/mcp-grants` (dans `main`)
Branche : claude/project-thread-ab4eh2
Propriétaire : fil « Brancher ses agents IA sur Impera » ; relecteurs Design (apps/web), Sécurité (accès d'agent)

## Objectif
Le propriétaire connecte un agent à lui (Claude Code sur le PC, son logiciel de comptabilité) sans requête à la main : il nomme l'agent, choisit l'agence ou une créatrice, coche les lectures, choisit une durée, confirme son mot de passe et son code, et reçoit le jeton une seule fois avec la ligne pour Claude Code. Il voit ses agents et les révoque.

## Contexte à lire
ADR 0026 § 3 et § 5, ADR 0105 § 1 et § 4, ADR 0144 ; `apps/api/src/modules/mcp/README.md` ; glossaire (Agent connecté, Accès d'agent, Jeton d'agent, Capacité) ; `apps/web/src/security/ExtensionLinksPanel.tsx` (même geste pour un jeton montré une fois).

## À faire
- [x] Écran `apps/web/src/settings/agents/` sur les routes existantes, dans Réglages › IA ; propriétaire seul.
- [x] Seules les lectures servies sont proposées, aucune cochée d'office ; une ligne ambre quand un texte (messages, scripts) part chez le fournisseur de l'agent.
- [x] Connexion récente : mot de passe et code redemandés par `PasswordPrompt`.
- [x] Guide « Brancher un agent IA » dans Aide, et à côté de l'écran.
- [x] Tests de l'écran ; listes de Réglages mises à jour.
- [x] Maquette Nuit/Jour, PC/téléphone, données inventées.
- [x] OK de Charles sur la maquette (26/11, « ok »).
- [x] Sécurité : OK sur 28b2b22c1 ; avertissement « lit et résume, jamais un agent qui agit » sur les textes des fans, deux lignes au guide (jeton en clair dans le terminal, durée la plus courte). Claude Desktop par un pont tiers : fermé.
- [x] Design : retouches (préfixe `mca-`, `sc-option`, jetons de durée, bouton Copier à côté de chaque valeur, entrées animées, alignement téléphone).
- [ ] OK de Design sur le dernier commit.

## Critères d'acceptation
- Aucune capacité cochée d'office ; aucun geste (`write:*`, `prepare:*`) proposé.
- Le jeton n'est montré qu'à la création, jamais relu ni gardé par l'écran.
- Aucune valeur réelle dans les tests, la doc ou les captures.

## Hors périmètre
OAuth (`PROPOSED-mcp-oauth`), gestes du lot b, guide Claude Desktop par un pont tiers (à décider avec Sécurité).
