# Serveur MCP, lot a : accès d'agent, journal et catalogue de lecture

Statut : proposed
Phase : MCP (ADR 0026, amendée par 0105) ; après la lecture Reveal dans la file de Bilan
Dépend de : ADR 0026 et 0105 acceptées, ADR 0087 lot a (rôle de service), EQ-01 (`withMember`, `/v1/me`), EQ-11 (Réglages par rôle)
Branche : task/<id>-mcp-read

## Objectif

Un agent externe (d'abord une session Claude Code sur le PC de l'agence, branchée sur `localhost`) se branche sur `POST /v1/mcp` avec un jeton d'agent créé dans Réglages › Agents connectés, et lit ce que le CRM sait : état de l'agent de chatting, À traiter, Bilan, ventes relevées, relevés quotidiens, consommation IA, conversations et fans de sa créatrice, équipe, relevés de commission, dépôts et scripts. Chaque appel entre au journal. Ce lot reprend l'ancien lot 3 (lectures de l'Équipe), qui n'a plus de raison d'attendre.

## Contexte à lire

ADR 0026 et 0105 en entier, ADR 0005, 0016, 0021, 0023, 0024, 0046, 0053, 0075, 0087 ; `docs/conventions/api.md`, `docs/conventions/security.md` §1 et §6 ; `docs/architecture/modules.md` ; `docs/architecture/threat-model.md` ; `apps/api/src/auth.ts` (`createRequireRole`, `createRequireRecentLogin`, `currentUserById`) ; les relectures Bilan et Sécurité de la PR de l'ADR 0105.

## À faire

- [x] Contrats (propriétaire de `packages/contracts`) : `mcp.ts` avec `McpCapabilitySchema` (liste fermée de 0026 § 4 et 0105 § 4, dont `read:sales`, `read:media`, `read:script_content`), schémas d'entrée et de sortie des outils du lot, `McpGrantSchema` sans le jeton.
- [x] Base (propriétaire de `packages/db`) : table `mcp_grants` (personne, créatrice nullable, capacités, empreinte SHA-256 indexée du jeton, expiration, révocation, dernière utilisation), migration nouvelle (numéro demandé au coordinateur), FORCE RLS, harnais d'isolation. Création, liste et révocation par `withMember` en scope `owner`. Une seule recherche hors créatrice, `findGrantByTokenHashUnscoped`, par le rôle de service en lecture seule ; sa ligne `GRANT … TO impera_service` dans la migration et dans le test du rôle de service (ADR 0087, lot a). Dernière utilisation et journal s'écrivent sous l'identité de la personne, jamais par `withAdmin`.
- [x] Jeton : 256 bits aléatoires au moins, un préfixe reconnaissable, une règle `gitleaks` dédiée à ce préfixe dans `.gitleaks.toml`, stocké par son empreinte seule, comparé par l'empreinte, jamais journalisé.
- [x] Prérequis (propriétaire de la racine de composition) : sortir d'`auth.ts` le calcul de l'acteur qu'utilise `requireRole` (`resolveActor(db, userId)`) ; il refuse un compte sans second facteur actif, comme `requireRole` (0105 § 1). Le MCP n'a aucun calcul de droits à lui.
- [ ] Prérequis, par le propriétaire de chaque module exposé et dans sa propre PR : descendre dans `application/` la vérification d'accès qu'une route exposée porte encore dans `infra/http`.
- [ ] Module `mcp` : README, domaine pur (catalogue, capacités, intersection des droits, liste « jamais exposé », règle « aucun outil n'atteint une commande gardée par une reconfirmation »), répartiteur, transport HTTP streamable sans état (SDK `@modelcontextprotocol/sdk` épinglé, quarantaine de 14 jours, justifié dans la PR). `/v1/mcp` n'accepte que `Authorization: Bearer` : jamais le jeton en paramètre d'URL, jamais la session du CRM ni son cookie. Règle d'`Origin` de 0026 § 2. Entrée dans `MODULE_DEPENDENCIES`, règle « `mcp` n'importe pas `@impera/db` », test de frontière.
- [ ] Droits recalculés à chaque appel : membre parti, créatrice retirée, rôle changé, compte suspendu ou sans second facteur → l'accès perd aussitôt ce qu'il n'a plus. Seul le propriétaire crée un accès, derrière `recentLogin`.
- [ ] Outils de lecture : ceux de 0026 § 5 (`whoami`, `creators_list`, `creator_get`, `agent_status`, `todo_list`, `stats_get`, `conversations_list`, `conversation_get`, `conversation_messages`, `drafts_pending`, `fan_get`, `shifts_list`, `on_shift_now`, `shift_reports_list`, `commission_statements_list`) et ceux de 0105 § 4 (Bilan, relevés quotidiens, consommation IA, ventes relevées, fiche du fan, équipe importée, dépôts et scripts). Chaque message lu porte son auteur (chatteur nommé, agent, créatrice). Texte venu d'un fan, faits, résumé, fiche et propositions dans le champ `untrusted`. Texte des étapes d'un script seulement avec `read:script_content`, qui ne se coche que sur un accès du propriétaire. Aucun média ni URL de média, aucun champ du dossier prestataire, aucun taux.
- [ ] Ressources miroirs (`impera://todo`, `impera://creators/{id}/status`, `impera://team/on-shift`) et les trois prompts de 0026 § 7, versionnés ; `serverInfo` `impera-mcp`.
- [ ] Journal : chaque appel dans `audit_log` (`mcp.<outil>`, accès, identifiants, issue, `requestId`), sans texte ; lectures d'agent en catégorie à part.
- [ ] Limites par accès (lectures), garde-fou d'exfiltration (la lecture d'une fiche de fan compte comme celle d'un fan), suspension et alerte importante, interrupteur « Agents connectés ». Échecs d'authentification par le limiteur partagé.
- [ ] Recette sur le bac à sable (`IMPERA_SANDBOX=1`, `pnpm sandbox:world`) : un client MCP du SDK lit le monde simulé ; jamais de donnée réelle dans un test.
- [ ] Écran Réglages › Agents connectés (propriétaire d'`apps/web`) : liste, création avec le jeton montré une fois, capacités jamais cochées d'office, phrase d'avertissement pour `read:conversation_content` (le texte des fans et le prénom des chatteurs partent chez le fournisseur du modèle de l'agent) et `read:script_content`, révocation, dernière utilisation. Captures Nuit/Jour, PC/téléphone avant fusion.
- [ ] Docs : `api.md` (`/v1/mcp`), `security.md` §1 (l'exception), modèle de menaces (acteur « agent connecté »), `modules.md`, mode d'emploi pour brancher Claude Code sur `localhost` (l'API n'écoute que sur la machine, `HOST` local ; jeton dans la configuration locale, hors dépôt et hors dossier synchronisé ou partagé).

## Critères d'acceptation

- Test de contrat : un client MCP du SDK liste les outils, appelle chacun, reçoit les mêmes données que la route correspondante.
- Tests d'intégration (Testcontainers) : sans jeton, jeton expiré, révoqué, en paramètre d'URL, ou session du CRM seule → refus ; compte sans second facteur → refus ; membre marqué parti → refus à l'appel suivant ; accès sans créatrice → aucun outil de créatrice ; scope `self` → seulement ses créatrices routées ; créatrice A → rien de B ; sans `read:conversation_content` → aucun texte de fan ; sans `read:script_content` → aucun texte d'étape ; aucun champ du dossier prestataire ni taux dans une réponse ; chaque appel a sa ligne de journal ; limite et garde-fou se déclenchent.
- Test d'instantané du catalogue ; test qui échoue si un outil de la liste « jamais exposé » apparaît, ou si un outil atteint une commande gardée par une reconfirmation.
- `pnpm check` et `pnpm test:all` verts.

## Hors périmètre

Écritures, dépôts et actions préparées (lot b), OAuth (lot c), liens de suivi de la plateforme (fiche à part quand le CRM les lira), accès créés par une créatrice ou un chatteur.

## Notes de session

- 14/11 : `resolveActor(db, shiftCreators, userId)` sorti d'`auth.ts` (PR 1 du lot a), `currentUserById` passe par lui ; le refus d'un compte sans second facteur reste à appliquer par le module `mcp`, qui lit `secondFactorEnabled`. Table des accès, migration et transport attendent le rôle de service (ADR 0087, #716).
- 14/11 : PR 2 du lot a, domaine pur du module `mcp` (`MCP_CATALOGUE` et son instantané, `decideCall`, `grantProblems`, `NEVER_EXPOSED`) et `McpCapabilitySchema` dans `packages/contracts/src/mcp.ts` ; `mcp: []` dans `MODULE_DEPENDENCIES`. Pas d'`index.ts` tant que rien ne l'importe (knip).
- 14/11 : PR 3 du lot a, accès d'agent : `McpGrantSchema` et le jeton (`impmcp_`, règle `gitleaks`) dans les contrats ; table `mcp_grants` (migration 0193, numéro provisoire du coordinateur) avec FORCE RLS, droits du propriétaire sous `withMember`, `GRANT SELECT` au rôle de service ; routes `/v1/settings/mcp-grants` derrière `recentLogin` ; `grantOfToken` prêt pour le transport. Les schémas d'entrée et de sortie des outils viennent avec eux.
- 14/11 : PR 4 du lot a, transport `POST /v1/mcp` (SDK 1.32.2 épinglé, transport aux standards du Web, sans état), porte `Bearer` seule avec un refus unique compté par adresse, règle d'`Origin`, répartiteur (`decideCall` relu à chaque requête, 60 lectures par minute et par accès), journal `mcp.<outil>` sous `withMember`, outil `whoami`. Reste : les autres outils de lecture, ressources et prompts, garde-fou d'exfiltration et interrupteur, écran, docs d'usage.
