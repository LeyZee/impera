# 2026-10-27 — FakeReveal et capture express (fil Connexion Reveal, hors fiche) — done

Fait : FakeReveal dans `apps/api/src/__tests__/fake-reveal/` (serveur Fastify de test, état en mémoire, fixtures inventées `default` et `empty`, scénarios et horloge pilotables, 17 routes provisoires pour L1 à L14 et E1 à E6) ; 18 tests de comportement ; test de fidélité (chaque endpoint répond avec sa forme déclarée ; chaque enregistrement de `recordings/` passe la forme de son endpoint). Page courte `docs/runbooks/reveal-capture-express.md`.
Pas fait : `RevealApiConnector`, `FetchMedia`, formes observées (attendent la capture) ; scénario `ws_drop`.
Décisions : FakeReveal vit sous `src/__tests__/` (typecheck, lint, knip et Vitest déjà configurés) plutôt que `apps/api/test/` ; les docs qui citaient l'ancien chemin sont corrigées. Les routes `/api` sont inventées et marquées provisoires (`OBSERVED_ON` vide) jusqu'à la capture.
Découvertes : l'élément ESLint `api-test` (`apps/api/test`) ne sert plus à rien.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, `pnpm test`.
