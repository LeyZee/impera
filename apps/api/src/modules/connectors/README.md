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

## Structure

- `domain/` : types, règles pures, machines d'état. Zéro I/O, zéro import de framework.
- `application/` : cas d'usage (commandes, requêtes, handlers de jobs). Orchestrent le domaine et les ports.
- `infra/` : implémentations (Drizzle, HTTP Fastify, jobs Graphile, clients externes).
- `index.ts` : **seule** porte d'entrée publique du module. Tout ce qui n'y est pas exporté est privé.

Voir `docs/architecture/modules.md` pour les règles communes et `docs/playbooks/add-a-module.md` pour en créer un.
