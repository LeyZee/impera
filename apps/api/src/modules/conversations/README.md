# Module `conversations`

**Rôle.** Ingestion idempotente des messages, machine d'état de la conversation, journal d'événements, files par conversation, drafts et envoi vérifié.

**Peut dépendre de.** fans, persona, agent, media. L'envoi passe par le port `OutboundSender` (`domain/ports.ts`), implémenté par `connectors` ; `supervision` réagit aux événements de l'outbox `domain_events` (`draft_created`) et n'est jamais importé ici.

**Règles propres.** Propriétaire des tables `conversations`, `messages`, `conversation_events`, `drafts`, et `alert_seen` (le « vu » de l'historique des alertes, une marque par événement du journal, partagée par l'agence ; P4-01).

**Exposé (`index.ts`).** `createConversationsModule({ db, fans, sender, requireRole, clock? })` : les commandes (`ingestMessage`, `approveDraft`, `rejectDraft`, `expireDraft`, `takeover`, `release`, `setMode`, `rebuildProjection`), les routes `/v1/conversations` (une conversation que la créatrice n'a pas, inexistante ou d'une autre créatrice, répond 404 `conversation_not_found` sur sa fiche comme sur ses messages, ses événements et sa courbe de désir, jamais une page vide), l'historique des alertes `/v1/alerts/triggers` (liste par créatrice, filtres `seen` et `alert`, « vu » un par un ou jusqu'à une date ; les noms des alertes par le port `AlertNames`, branché sur `alerts`) et les handlers des jobs `conversation.respond` et `conversation.send`, que le composition root enregistre.

**Invariants.** Tout événement passe par `appendEvent` (`application/journal.ts`) : transition vérifiée, journal, projection et outbox dans la même transaction, sous le verrou de la conversation. Un job s'enfile dans cette même transaction (`public.enqueue_job`).

## Structure

- `domain/` : types, règles pures, machines d'état. Zéro I/O, zéro import de framework.
- `application/` : cas d'usage (commandes, requêtes, handlers de jobs). Orchestrent le domaine et les ports.
- `infra/` : implémentations (Drizzle, HTTP Fastify, jobs Graphile, clients externes).
- `index.ts` : **seule** porte d'entrée publique du module. Tout ce qui n'y est pas exporté est privé.

Voir `docs/architecture/modules.md` pour les règles communes et `docs/playbooks/add-a-module.md` pour en créer un.
