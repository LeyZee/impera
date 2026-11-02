# Module `connectors`

**Rôle.** Port `PlatformConnector` et ses adaptateurs (`RevealApiConnector`, `FakeConnector`, plus tard `NirvanaPlatformConnector`). Seul module autorisé à parler à une plateforme externe.

**Peut dépendre de.** conversations (`ingestMessage` pour les messages entrants). Implémente aussi le port `OutboundSender` défini dans `conversations/domain/ports.ts` ; le composition root fait le branchement, `conversations` n'importe jamais ce module.

**Règles propres.** Aucun autre module n'importe un adaptateur directement : tout passe par le port.

## Ce qui existe (P0-06)

- `domain/platform-connector.ts` : le port et `ConnectorError` ; `domain/rhythm.ts` : rythme des relèves et coupe-circuit.
- `application/` : jobs `dispatch`, `poll`, `reconcile` ; `sessions` ; `outbound-sender` (port `OutboundSender` de `conversations`).
- `infra/fake/FakeConnector.ts` : plateforme en mémoire à scénarios. `infra/__tests__/contract.test.ts` : la suite que tout adaptateur doit passer.
- `infra/http/routes.ts` : `POST /v1/connector/sessions`, la « Sync » de l'extension, authentifiée par le jeton d'appareil (`x-extension-token`) vérifié dès l'arrivée de la requête : sans jeton valide, 401 `device_unauthenticated` avant toute lecture du corps (jamais un 400 qui listerait les champs attendus).
- Un adaptateur se branche par le registre (`ConnectorRegistry`, une fabrique par plateforme) passé à `createApp` ; registre vide = aucun compte relevé.

## Flux de ventes (CRM-01, ADR 0050)

Deuxième port, distinct du connecteur : `PlatformSalesFeed` (`domain/sales-feed.ts`) lit les ventes, les remboursements, les modèles, l'équipe et les chiffres d'une plateforme avec une clé d'agence, sans session.

- `infra/reveal-crm/` : l'adaptateur de l'API CRM Reveal (`api.reveal.me`, en-tête `x-api-key`), schémas dans `wire.ts`. 401 et 403 rendent la clé « à reconnecter », 429 suit `Retry-After`, une forme inattendue ou un net différent de agence + créatrice refuse toute la page. Le pseudo du fan ne passe jamais l'adaptateur.
- `application/sales-feed.ts` : Réglages (connecter, retirer, relier un modèle ou un chatteur) et le job `connector.read_sales` (une fois par minute, `crontab.ts`), qui lit au plus 20 pages par passage.
- `infra/db/sales-feed-keys.ts` : la clé, scellée avec `CREDENTIALS_ENCRYPTION_KEYS` (contexte `sales_feed:<plateforme>`) dans `sales_feed_credentials`, retirée au rôle applicatif ; rechiffrée par `pnpm ops:reencrypt-credentials`, vérifiée par `pnpm ops:check-keys`. Table propre et non `provider_credentials`, dont l'enum ne connaît que les services d'IA.
- `infra/db/sales-ledger.ts` : les lignes et le curseur dans une seule transaction (curseur verrouillé, page périmée ignorée) ; ligne unique sur (plateforme, vente, événement) ; modèle inconnu en quarantaine ; signaux par `domain_events`.
- `infra/http/sales-feed-routes.ts` : `/v1/settings/sales-feeds…`, propriétaire seul ; connecter ou retirer la clé redemande une connexion récente. Aucune réponse ne contient la clé. Les refus portent un code de `SALES_FEED_ERROR_CODES` et leur phrase.
- Quarantaine : relier un modèle fait entrer au registre, dans la même transaction, toutes ses ventes en attente ; l'écran peut donc dire « N ventes en attente seront comptées ». Le `quarantined` de la ligne d'état est la somme de celui des modèles. L'aperçu donne aussi les comptes qu'on peut choisir (`accounts`, avec le modèle déjà lié à chacun) et qui a posé chaque lien (`linkedBy` : `auto` par le pseudo à la connexion, ou le membre).

Tables possédées : `sales_feed_credentials`, `sales_feed_cursors`, `sales_feed_models`, `sales_feed_chatters`, `platform_sales`, `platform_sales_quarantine` (migration 0062). Tests contre le faux CRM de `__tests__/fake-reveal/crm.ts`.

## Structure

- `domain/` : types, règles pures, machines d'état. Zéro I/O, zéro import de framework.
- `application/` : cas d'usage (commandes, requêtes, handlers de jobs). Orchestrent le domaine et les ports.
- `infra/` : implémentations (Drizzle, HTTP Fastify, jobs Graphile, clients externes).
- `index.ts` : **seule** porte d'entrée publique du module. Tout ce qui n'y est pas exporté est privé.

Voir `docs/architecture/modules.md` pour les règles communes et `docs/playbooks/add-a-module.md` pour en créer un.
