# Stratégie de tests

Six couches, chacune avec un outil et un but. Une PR touche la couche qui correspond à ce qu'elle change ; on ne « compense » pas un test manquant par un autre.

| Couche | Outil | Quoi | Vitesse | Quand |
|---|---|---|---|---|
| Unitaire domaine | Vitest | Règles pures, machines d'état, politiques, gardes, schémas Zod | ms | `pnpm test`, à chaque push (hook) |
| Écran web | Vitest + jsdom + Testing Library | Ce qu'un écran d'`apps/web` montre et fait : états (vide, erreur, liste), clavier, confirmations, état partagé entre écrans ; `fetch` remplacé par un faux serveur | ms | `pnpm test`, à chaque push (hook) |
| Intégration | Vitest + Testcontainers (Postgres) | Repositories, RLS, jobs Graphile, cas d'usage de bout en bout sur une base réelle | s | `pnpm test:integration` (Docker requis), CI |
| Contrat connecteur | Vitest | La **même suite** tourne contre `FakeConnector`, `FakeReveal` (serveur mock) et, à la main, contre Reveal réel en lecture | s | CI (Fake) ; manuel (réel) |
| E2E | Playwright | Dashboard (inbox copilote), extension contre `FakeReveal` | min | `pnpm test:e2e`, CI nightly + avant release |
| Qualité IA | Exécuteur maison (`apps/api/src/scripts/evals.ts`) et juge LLM | Scénarios, rubriques, adversarial, régression de prompts et de modèles, sur le vrai chemin de l’agent | min, coûte des tokens | `pnpm evals` : sous-ensemble en CI nightly ; complet avant changement de persona/modèle |

`pnpm check` est statique (typecheck, lint, format, knip, `check-repo`) et ne lance aucun test ; `pnpm test:all` enchaîne unitaire et intégration.

## Règles

- Les tests du domaine ne touchent ni base, ni réseau, ni horloge réelle (horloge injectée : `clock.now()`).
- Les tests d'intégration créent leur schéma via les migrations réelles (pas de `sync`) : un conteneur Postgres par exécution (Testcontainers), une base par fichier de test, une transaction annulée à la fin de chaque test. Le Postgres de dev (`docker compose up -d`) sert au `pnpm dev`, pas aux tests. Sans Docker (session cloud), `NIRVANA_TEST_PG_URL` désigne un Postgres 16 jetable (URL superutilisateur) à la place du conteneur ; le reste ne change pas (`packages/db/README.md`).
- Chaque bug corrigé commence par un test qui le reproduit.
- Les fixtures sont inventées, courtes, nommées (`fixtures/fans.ts: theQuietFan`), avec des fabriques (`makeFan(overrides)`) plutôt que des objets copiés. Jamais de donnée réelle.
- Les tests de politique et de gardes couvrent systématiquement : le cas nominal, le cas limite, le cas adversarial.
- Un test d'écran déclare `// @vitest-environment jsdom` en tête de fichier (le reste d'`apps/web` tourne sous Node), cherche par rôle et par nom accessible comme le ferait un lecteur d'écran, et ne remplace que ce que jsdom n'a pas (`matchMedia`, `ResizeObserver`, `scrollTo`).
- Un test flaky est corrigé ou supprimé dans la journée, jamais mis en `retry`.

## FakeReveal

Un serveur HTTP (Fastify, dans `apps/api/src/__tests__/fake-reveal/`) qui imite l'API de Reveal telle qu'observée (phase 1), piloté par des scénarios (`scenarios/*.json` : messages qui arrivent à t+X, session qui expire, erreur 500, rate limit). C'est contre lui que tourne le connecteur en CI et en dev. Il est mis à jour à chaque changement observé de Reveal (voir `docs/reference/reveal-api-observed.md`), et ses enregistrements anonymisés sont versionnés dans le dépôt (`apps/api/src/__tests__/fake-reveal/recordings/`, sans secret ni donnée réelle) et protégés (hygiene.md).

## Évals (résumé, détail dans `docs/playbooks/write-an-eval.md`)

- `evals/scenarios/` : conversations simulées (fan joué par un script ou un modèle), un fichier par scénario, avec le résultat attendu du **cerveau** (décision, faits, risques) et la rubrique de la **voix**.
- `evals/adversarial/` : injections et pièges.
- `evals/regression/` : cas réels anonymisés et validés par Messa (plus tard), figés.
- Seuils dans `evals/thresholds.json` ; la CI échoue si le sous-ensemble `smoke` passe sous le seuil.
- Pourquoi pas Promptfoo : un scénario doit passer par le même chemin qu’un vrai message (cerveau, politique `holdDecision` / `offerDecision`, voix, gardes dures, `composeTurn`). Promptfoo n’appellerait que des prompts isolés ; l’exécuteur maison appelle le code de l’agent, puis le rôle `judge` de `LlmGateway` note la réponse comme une donnée (`<candidate_reply>`).
