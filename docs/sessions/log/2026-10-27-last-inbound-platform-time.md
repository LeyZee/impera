# 2026-10-27 — « A écrit il y a… » à l’heure de la plateforme (recette locale, Bilan) — done
Fait : `ConversationSummary.lastInboundAt` lit `max(messages.platform_created_at)` des messages entrants au lieu de `conversations.last_inbound_at` (heure de lecture par Nirvana) ; la colonne garde son rôle d’ordre d’arrivée (debounce, brouillon périmé, relances), qu’une heure de plateforme casserait : un message lu en retard serait plus vieux que le brouillon qui l’ignore. Test dans `conversations-http.integration.test.ts`.
Pas fait : rien.
Découvertes : le filet « Sans réponse » du Dashboard (supervision) compte depuis `last_inbound_at` ; pour une capture qui relit l’historique, c’est l’heure de lecture, ce qui évite d’y faire tomber tout l’historique d’un coup.
