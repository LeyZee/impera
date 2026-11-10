# P1-02 Analyse de l'API Reveal et FakeReveal

Statut : review (PR ouverte le 2026-11-10)
Phase : 1
Dépend de : P1-01 (ou une capture HAR anonymisée, voir `docs/runbooks/reveal-recording.md`)
Branche : task/p1-02-reveal-api-analysis

## Objectif
Répondre aux 14 questions de `connectors.md` dans `docs/reference/reveal-api-observed.md` et livrer un FakeReveal qui reproduit les endpoints nécessaires au connecteur.

## Contexte à lire
`docs/architecture/connectors.md` (questions et conduite), `docs/reference/reveal-api-observed.md` (gabarit), `docs/conventions/testing.md` (FakeReveal).

## À faire
- Charles enregistre 2 ou 3 sessions, avec l'enregistreur (P1-01) ou en HAR (`docs/runbooks/reveal-recording.md`, anonymisé par `scripts/anonymize-har.mjs`), et dépose les exports **anonymisés** dans `.scratch/inbox/` (pas dans le dépôt).
- Analyser : endpoints, auth, identifiants, temps réel, écritures (CSRF/signature), anti-bot, ventes, médias, rate limits. Documenter chaque endpoint utile avec un exemple anonymisé.
- Vérifier la stabilité sur deux enregistrements à des jours différents.
- `apps/api/src/__tests__/fake-reveal/` : serveur Fastify reproduisant ces endpoints (formes de réponses, codes d'erreur, pagination), scénarios pilotables (`POST /__scenario`), fixtures fictives.
- Mettre à jour `ConnectorCapabilities` attendues pour Reveal.
- Si l'enregistreur n'a pas suffi (WebSocket binaire, chiffrement applicatif), le dire et proposer la suite (C ou analyse plus poussée).

## Critères d'acceptation
- Les 14 questions ont une réponse sourcée (enregistrement, date).
- FakeReveal démarre, et un client `undici` minimal (dans le test) reproduit le parcours : liste → conversation → envoi → relecture, contre FakeReveal.
- Aucun identifiant réel ni contenu réel dans le dépôt (revue manuelle + gitleaks).

## Hors périmètre
Le connecteur de production (P2).

## Notes de session

2026-11-10 (Bilan) : trois captures HAR du même jour, anonymisées sur le PC de Charles. `reveal-api-observed.md` répond aux 14 questions ; FakeReveal sert les 19 routes observées (`model.ts`, `server.ts`), avec un enregistrement par route dans `recordings/2026-11-10/` et un parcours liste → conversation → envoi → relecture par `fetch` (undici) sur un vrai port. `REVEAL_EXPECTED_CAPABILITIES` fixe les capacités attendues (temps réel : non).

Reste (liste « Ce qui reste ouvert » de `reveal-api-observed.md`) : session invalide (L1), premier message et types de messages rares, énumérations masquées, `%NAME%`, séquence remplie, bornes et erreurs, liens de médias (L14, L15), et une capture un autre jour pour la stabilité. Une capture courte suffira, avec l'anonymiseur ajusté (garder les énumérations, signaler `%NAME%` sans le texte).
