# Ajouter un connecteur de plateforme

Référence : `docs/architecture/connectors.md`, ADR 0008.

1. **Observer avant de coder.** Documente l'API (ou le DOM) de la plateforme dans `docs/reference/<platform>-api-observed.md` : endpoints, auth, identifiants, temps réel, écritures, ventes, rate limits. Avec l'enregistreur de l'extension si c'est une plateforme web sans API.
2. **Capacités.** Écris le `ConnectorCapabilities` du connecteur (non-lus sans ouvrir ? WebSocket ? transactions ? typing ? bornes de prix ?). Le cœur s'y adaptera.
3. **Fake d'abord.** Un serveur mock `apps/api/src/__tests__/fake-<platform>/` qui implémente ce que tu as observé, avec scénarios pilotables (`POST /__scenario`). C'est lui qui fait tourner les tests, pas la vraie plateforme.
4. **Adaptateur.** `modules/connectors/infra/<platform>/` : client HTTP (undici) ou pilote navigateur, mappage vers les types de `packages/contracts/src/connector.ts`, erreurs mappées vers `ConnectorError` typées, clés d'idempotence respectées, `verifySent` implémenté.
5. **Test de contrat.** Ajoute le nouvel adaptateur à `connectors/__tests__/contract.test.ts` (même suite que `FakeConnector` et Reveal). Il doit passer contre le fake.
6. **Session.** Si la plateforme demande une session capturée : extension (bouton Sync pour ce domaine), endpoint `/v1/connector/sessions`, chiffrement AES-256-GCM via `packages/db` (`encryptSecret`), `platform_accounts.session_*`.
7. **Conduite.** Rythme humain, jitter, coupe-circuit, egress configuré, User-Agent et en-têtes observés. Tout dans `connector_config`.
8. **Enregistrement.** `connectors/index.ts` : fabrique `createConnector(platformAccount)` qui retourne le bon adaptateur selon `platform`. Ajoute la valeur à l'enum `Platform` dans les contrats et au `check` SQL (migration).
9. **Docs.** Tableau des adaptateurs dans `connectors.md`, ADR si la stratégie d'accès est nouvelle.
10. **Jamais** : pas de test contre la vraie plateforme en CI ; pas d'identifiants réels dans les fixtures ; pas de contournement de protection anti-bot au-delà d'un client qui se comporte comme le client officiel.
