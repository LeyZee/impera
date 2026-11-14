# P2-02 `RevealApiConnector` en lecture

Statut : done
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
- Tests unitaires du mappage : texte entrant et sortant, bundle verrouillé et acheté, étape de script, message du membre « bot » reconnu (par id d'abord, nom affiché en repli), message écrit par la modèle elle-même ou un chatteur (sortant, pas le nôtre), moment ☀️ / 🌙 / aucun, étape déjà envoyée et achetée.
- Test d'intégration : un poll sur FakeReveal ingère les messages sans doublon, puis une session expirée arrête le compte.
- Aucun jeton dans les logs (test).

## Hors périmètre
Écritures (P2-03), `fetchMedia`, appels au vrai Reveal.

## Notes de session
- 2026-11-12 (Opus 5.5) : livré contre FakeReveal seulement, aucun appel au vrai Reveal. V1 (11/11) et V2 (12/11) de P2-01 sont consignées dans cette même branche : JWT de 24 h, 401 après `exp` ; `health` avertit 2 h avant `exp`.
- Formes : celles de FakeReveal déplacées dans `connectors/infra/reveal/wire.ts` (`REVEAL_ENDPOINTS`), que FakeReveal importe : une seule copie, toujours tenue par `fidelity.test.ts`.
- Contrat : suite coupée en lectures (FakeConnector et RevealApiConnector + FakeReveal) et écritures (FakeConnector seul, Reveal y entre avec P2-03) ; nouveau monde FakeReveal `quiet`. Chaque lecture de l'ADR 0018 y a son cas (drapeau ⇔ méthode, réponse au schéma du contrat).
- Contrat partagé : `ExternalMessage.author` (`fan`, `ai`, `human`) facultatif, pour dire « sortant mais pas le nôtre ». Le cœur ne le lit pas encore : `ingestMessage` met toujours `human` sur un sortant inconnu.
- Écarts à la spécification, corrigés dans `reveal-connector-spec.md` : un fan inconnu relit toute la liste (pas `searchParticipants`, qui prend un pseudo) ; un 403 en page HTML est `fatal` « challenge » ; le moment ne retombe que sur les dossiers des médias vendus, quand ils s'accordent.
- Drapeaux de `RevealApiConnector` : lectures à `true`, `sendMedia`, `markRead`, `typing` à `false` jusqu'à P2-03 ; `sendText`, `sendMedia` et `verifySent` lèvent `fatal`.
- Reste (hors fiche) : d'où vient le nom affiché du membre « bot » (repli de la reconnaissance de nos messages, `botDisplayName` vaut `null` dans le registre) ; les ids de nos envois arriveront avec `connector_sends` (P2-03).
- Attention : Reveal est désormais au registre par défaut (`wiring/connectors.ts`). Un compte dont la session est synchronisée sera relevé par le worker, en lecture, contre `api.reveal.me`.
- Ajout du coordinateur : `FanPpvStats.lastOfferAt`, le `createdAt` le plus récent des bundles `kind=paid` de `ppv-history` (aucun champ propre chez Reveal), `null` sans offre payante. Une transaction Reveal ne porte ni l'id du bundle ni celui de l'étape : seul le message porte `bundle.transactionId` (et `message.bundleId`), et aucun message ni aucune transaction ne porte `scriptId` dans les formes observées.
