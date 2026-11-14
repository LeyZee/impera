# 2026-11-14 — Lectures de conversations descendues dans `application/` (prérequis MCP) — done
Fait : prérequis de PROPOSED-mcp-read (ADR 0026 § 1, ADR 0105) pour le module `conversations`. La vérification d'accès des lectures (arrêt d'urgence, liste, conversation, messages, événements, courbe de désir) quitte `infra/http/routes.ts` pour `application/reads.ts` : `ConversationViewer`, borné par des identifiants de créatrices (créatrices entières ou `'all'`, fenêtre de shift, conversations routées), et `createConversationReads`. Le module les expose par `reads` dans son `index.ts`. Les routes les appellent, sans changer de comportement (mêmes 401, 403 `creator_forbidden` et `conversation_forbidden`, 404, même trace d'ouverture d'un chatteur). Les deux erreurs passent dans `domain/errors.ts`.
Pas fait : les lectures de supervision (`agent_status`, `todo_list`, `stats_get`, `fortnight_review_get`), dans une PR suivante. `drafts_pending` n'a pas de route à lui : le brouillon en attente est dans le détail d'une conversation.
Décisions : aucune ; rien ne change pour les routes.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, `pnpm test`, tests unitaires de `reads.ts`, intégrations des routes de conversations.
