# P2-02 `RevealApiConnector` en lecture

Statut : todo
Phase : 2
Dépend de : P2-01 (V1 réussie)
Branche : task/p2-02-reveal-connector-read

## Objectif
Le connecteur lit la boîte de réception, les messages, les profils, les notes, les statistiques PPV, les scripts et ce qui a déjà été envoyé à chaque fan, contre FakeReveal, et le poller de P0-06 l'utilise.

## Contexte à lire
`docs/reference/reveal-connector-spec.md` §§ 3, 4, 6 ; ADR 0018 ; `docs/architecture/connectors.md` ; `apps/api/src/modules/connectors/` ; `docs/reference/fake-reveal.md` ; `PROPOSED-reveal-connector.md` (fiche d'origine, dont celle-ci reprend la lecture).

## À faire
- Contrats : schémas de l'ADR 0018 dans `packages/contracts/src/connector.ts` (`FanProfile`, `FanNote`, `CreatorNote`, `FanPpvStats`, `PlatformScript`, `VaultMedia`) et drapeaux de `capabilities` ; méthodes optionnelles de lecture sur le port ; `FakeConnector` les déclare à `false`.
- `connectors/infra/reveal/` : schémas Zod des réponses utilisées (repris de FakeReveal, sans dupliquer), client `undici` (en-têtes, limites, erreurs typées de la spécification § 3), mappages de la spécification § 4 et § 6.
- `RevealApiConnector` : `health`, `listConversations`, `fetchMessages`, `listTransactions`, et les lectures de l'ADR 0018 (sauf `fetchMedia`).
- Inscription dans le registre de connecteurs (composition root) pour la plateforme `reveal`.

## Critères d'acceptation
- Suite de contrat verte contre `FakeConnector` et contre `RevealApiConnector` + FakeReveal, scénarios `session_expired`, `rate_limited`, `shape_changed` compris.
- Tests unitaires du mappage : texte entrant et sortant, bundle verrouillé et acheté, étape de script, message du membre « bot » reconnu, moment ☀️ / 🌙 / aucun, étape déjà envoyée et achetée.
- Test d'intégration : un poll sur FakeReveal ingère les messages sans doublon, puis une session expirée arrête le compte.
- Aucun jeton dans les logs (test).

## Hors périmètre
Écritures (P2-03), `fetchMedia`, appels au vrai Reveal.

## Notes de session
