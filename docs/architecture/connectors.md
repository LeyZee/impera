# Connecteurs : le port `PlatformConnector` et Reveal

Dernière revue : 2026-10-16. Décision : ADR 0008.

## Le port

Défini dans `apps/api/src/modules/connectors/domain/platform-connector.ts`, types dans `packages/contracts/src/connector.ts`.

```ts
interface PlatformConnector {
  readonly platform: Platform;
  health(): Promise<SessionState>;                                  // valid | warning | expired
  listConversations(opts: { since?: Date; limit?: number }): Promise<ConversationSnapshot[]>;
  fetchMessages(conversationRef: ExternalRef, opts: { since?: Date; limit?: number }): Promise<ExternalMessage[]>;
  sendText(conversationRef: ExternalRef, text: string, idempotencyKey: string): Promise<SendResult>;
  sendMedia(conversationRef: ExternalRef, media: OutboundMedia, idempotencyKey: string): Promise<SendResult>;
  verifySent(conversationRef: ExternalRef, idempotencyKey: string): Promise<VerifyResult>;
  listTransactions?(opts: { since?: Date }): Promise<ExternalTransaction[]>;   // ventes, si exposé
  markRead?(conversationRef: ExternalRef): Promise<void>;
  setTyping?(conversationRef: ExternalRef, on: boolean): Promise<void>;
  subscribe?(onEvent: (e: ConnectorEvent) => void): Promise<Unsubscribe>;     // WebSocket, si exposé
}
```

Règles :
- Toute méthode est idempotente ou porte une clé d'idempotence.
- Toute méthode lève une `ConnectorError` typée (`SessionExpired`, `RateLimited { retryAfter }`, `NotFound`, `Transient`, `Fatal`) ; jamais une erreur HTTP brute.
- `ConversationSnapshot` doit contenir au minimum : `ref`, `fanRef`, `fanDisplayName`, `unreadCount`, `lastMessageAt`, `lastMessagePreview?`. Si la plateforme ne donne pas `unreadCount` sans ouvrir la conversation, le connecteur le dit (`capabilities.unreadWithoutOpen = false`) et le poller s'adapte.
- `capabilities` est déclaré par chaque connecteur (ce qu'il sait faire) ; le cœur s'y adapte, jamais l'inverse.

## Les adaptateurs

| Adaptateur | Phase | Rôle |
|---|---|---|
| `FakeConnector` (en mémoire, scénarios) | 0 | Tests unitaires et d'intégration du cœur sans réseau |
| `FakeReveal` (serveur HTTP mock) + `RevealApiConnector` pointé dessus | 1 | Tests de contrat et e2e, dev local |
| `RevealApiConnector` | 2 | Production : API privée de Reveal via session capturée |
| `RevealBrowserConnector` (Playwright) | si B échoue | Roue de secours |
| `NirvanaPlatformConnector` (in-process) | 8 | Notre plateforme : pas de réseau, appel direct du module `platform` |
| `OnlyFansConnector`, `InstagramConnector` | 7+ | Plus tard |

## Stratégie Reveal : B cible, A outil, C secours

| | A. Runtime dans l'extension | **B. Session capturée → client API serveur** | C. Navigateur serveur (Playwright) |
|---|---|---|---|
| 24/7 | non | oui | oui |
| Fiabilité | faible (MV3, onglet) | élevée (API > DOM) | moyenne |
| Détection | nulle | moyenne (IP, empreinte) | faible |
| Testabilité | faible | excellente | moyenne |
| Ops | faible | faible | moyen |

Décision : **B**. L'extension garde deux rôles : **enregistreur** (découverte de l'API) et **capture de session** (bouton Sync). C reste prêt comme repli, derrière le même port.

### Ce que la phase 1 doit établir (`docs/reference/reveal-api-observed.md`)

1. REST ou GraphQL, base URL, versionnage.
2. Temps réel : WebSocket ? Polling côté client, à quelle fréquence ?
3. Liste des conversations avec non-lus et dernier message **sans ouvrir** chaque conversation ?
4. Stabilité des identifiants (fan, conversation, message).
5. Authentification : cookie de session, JWT, refresh, durée de vie, invalidation par nouvelle connexion ailleurs ?
6. Écritures : CSRF, signature, nonce ?
7. Protection anti-bot (Cloudflare, Turnstile, empreinte TLS) sur les endpoints API ?
8. Ventes PPV : comment elles apparaissent (événement, message typé, endpoint transactions) ?
9. Envoi de média : upload direct ? URL signée ? Limites ?
10. Rate limits observés.
11. Scripts natifs : liste, contenu (étapes, médias, prix, textes), trace de ce qui a été envoyé à un fan, endpoint d'envoi dédié ou non.
12. Historique : pagination de tout l'historique d'une conversation, des achats passés et des notes client (import initial, anti-doublon).
13. Notes client : lecture, écriture, format, concurrence avec un chatteur.
14. Âge des fans : Reveal vérifie-t-il l'âge, et l'expose-t-il.

Ce que le connecteur doit savoir faire, capacité par capacité : `docs/reference/reveal-connector-inventory.md`. Comment Charles capture une session : `docs/runbooks/reveal-recording.md`.

### Règles de bonne conduite du connecteur Reveal

- Un seul client par compte plateforme, jamais deux processus.
- Sortie par une IP française stable dédiée (VPS FR ou proxy), configurée par `connector_config.egress`.
- Rythme humain : polling à intervalle variable (jitter), envoi après délai de frappe, jamais de rafale.
- Coupe-circuit : après N erreurs consécutives (config), arrêt 10 min + alerte ; après `SessionExpired`, arrêt total jusqu'à re-sync.
- En-têtes et User-Agent identiques à ceux observés dans le vrai client, mis à jour avec lui.
- Tout endpoint utilisé est documenté dans `reveal-api-observed.md` avec un exemple anonymisé et un test FakeReveal.

## L'extension (apps/extension, WXT)

Trois fonctions, dans cet ordre de livraison :

1. **Enregistreur** (phase 1) : script en main world qui intercepte `fetch`/XHR/WebSocket sur le domaine Reveal, anonymise à la volée (identifiants hachés, contenus tronqués) et exporte un fichier JSON que la phase 1 analyse. Désactivé par défaut, activé manuellement.
2. **Capture de session** (phase 2) : bouton « Sync » qui lit les cookies/jetons de la session courante et les envoie, chiffrés, à l'endpoint `/v1/connector/sessions` du backend (jeton d'appareil). Jamais stockés dans l'extension.
3. **Relais d'actions** (optionnel, si B ne peut pas tout faire) : le backend met une action en file, l'extension la joue depuis l'onglet ouvert.

Contraintes MV3 à connaître : le service worker meurt après ~30 s d'inactivité (utiliser `chrome.alarms`, pas de `setInterval`) ; `webRequest` ne lit pas les corps de réponse (d'où le script main world) ; `host_permissions` limitées à `*://*.reveal.me/*`.

## FakeReveal

Spécification : `docs/reference/fake-reveal.md`. `apps/api/src/__tests__/fake-reveal/` : un serveur Fastify qui implémente les endpoints observés, avec des scénarios pilotables (`POST /__scenario`) : arrivée de messages à t+X, expiration de session, 429, 500, latence, conversation qui disparaît. Il sert aux tests de contrat (`connectors/__tests__/contract.test.ts` tourne contre `FakeConnector` et contre `RevealApiConnector`+FakeReveal), aux e2e Playwright, et au dev local sans compte Reveal.
