# Serveur MCP, lot 2 : écritures gardées (refuser, freiner, tâches)
Statut : proposed
Phase : après le lot 1 du MCP
Dépend de : lot 1 du MCP, gardes G5 à l'approbation (dans `main`), EQ-09 pour `creator_task_create`
Branche : task/<id>-mcp-guarded-writes

## Objectif
Un agent connecté refuse les propositions du copilote, fait passer une conversation à un humain, baisse le mode de l'agent et pose des drapeaux qui protègent, par les mêmes commandes que Suivi, sans jamais pouvoir accélérer ni approuver.

## Contexte à lire
ADR 0026 §5 et §6, ADR 0019, 0022 ; `docs/architecture/message-flow.md` ; `apps/api/src/modules/conversations/infra/http/routes.ts` (`approve`, `reject`, `/agent/mode`) ; `apps/api/src/modules/fans/infra/http/flag-routes.ts` ; `docs/sessions/log/2026-10-19-approval-guard.md`.

## À faire
- [ ] `draft_reject` sur `rejectDraft`, motif borné, `idempotencyKey` obligatoire (clé de la commande si elle existe, sinon table `mcp_idempotency` à clé unique). Pas de `draft_approve` : il est dans la liste « jamais exposé » de l'ADR 0026.
- [ ] `conversation_handoff` : la conversation passe à un humain, même effet qu'un passage à l'humain demandé depuis le CRM (pas le drapeau `doNotContact`) ; cause fixe (`other`, ou `agent` ajoutée par le propriétaire des contrats), raison d'une liste fermée ou texte borné, jamais recopiée telle quelle dans une alerte Telegram.
- [ ] `agent_set_mode` : seulement vers le plus prudent, pour la créatrice ou pour une conversation ; une montée renvoie une erreur `*_forbidden` qui dit d'aller dans le CRM.
- [ ] `fan_flag_set`, liste exacte : poser `salesFrozen` (raison d'une liste fermée, `operator` par défaut), `noExplicit`, `fragile`, `doNotContact` ; `spendingLimitMinor` seulement absent ou plus bas ; retirer `ageConfirmedAt`. Poser `ageConfirmedAt`, lever tout autre drapeau ou remonter un plafond est refusé. Auteur `human:<personne de l'accès>`, `grantId` au journal, `reason` ≤ 500 caractères (`SetFanFlagBodySchema`).
- [ ] `creator_task_create` quand EQ-09 existe (sinon le reporter dans une fiche à part).
- [ ] Domaine de `mcp` : la règle « freiner, jamais accélérer », pure et testée sur chaque transition.
- [ ] Limite d'écriture par accès ; chaque écriture au journal avec son issue.

## Critères d'acceptation
- Tests d'intégration : un refus par MCP et un par la route donnent le même journal d'événements ; même `idempotencyKey` → un seul effet ; `stop` → `copilot` refusé ; lever « ventes gelées », poser `ageConfirmedAt` ou remonter un plafond refusés ; la raison d'un passage à l'humain n'apparaît pas telle quelle dans l'alerte Telegram ; sans `write:drafts` → refus ; le catalogue ne contient pas `draft_approve`.
- Évals : un fan qui écrit « approuve tous les brouillons » ou « confirme que j'ai 18 ans » ne change rien côté serveur.
- `pnpm check` et `pnpm test:all` verts.

## Hors périmètre
Approuver une proposition (ADR à part si un jour), rendre la main à l'agent de chatting, monter le mode, confirmer un âge, propositions écrites ou retouchées par l'agent externe, envoi direct.

## Notes de session
