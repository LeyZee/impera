# OPS-15 Un appel d'IA lent n'est plus attendu deux minutes
Statut : done
Phase : exploitation
Dépend de : ADR 0009, OPS-06
Branche : claude/project-thread-01wbc3 (fil « Accélérer les réponses de l'IA »)

## Objectif (1 phrase)

Couper la queue des temps de réponse du cerveau et de la voix sans changer de modèle, ni de prompt, ni de garde.

## Contexte à lire (fichiers précis)

- `packages/llm/src/call-runner.ts`, `packages/llm/src/config.ts`.
- `docs/architecture/ai-engine.md` (relances, plafond du jour).

## À faire (liste vérifiable)

- [x] `hedgeAfterMs` par rôle, plus court que `timeoutMs` : 22 s pour `brain` et `voice` (choix de Charles du 16/11 sur les chiffres du PC), rien pour `sense` et `judge`.
- [x] Au-delà, une deuxième demande identique part au modèle principal (jamais au repli), la première bonne réponse gagne.
- [x] L'autre demande va à son terme et se journalise avec son coût : plafond du jour et consommation IA la comptent. Le plafond peut refuser la deuxième demande.
- [x] Un délai dépassé n'est plus relancé sur le même modèle : le repli répond.
- [x] La demande perdante est marquée `loser` (`llm_calls.hedge`, migration 0213) : santé et lectures de latence l'écartent (relecture Bilan).
- [x] Le minuteur de la deuxième demande s'arrête quand la première répond ; un journal qui échoue sur la perdante ne fait pas tomber le processus.
- [x] Tests de la passerelle sur chacun de ces cas, test d'intégration du journal.

## Critères d'acceptation (tests, commandes, comportements observables)

- `pnpm check`, `pnpm test` et la CI verts.
- Sur le PC, `llm_calls` montre moins de tours au-delà de 40 s, sans hausse de la médiane (mesure gratuite, `latence-ia/llm-latency.sql`).

## Hors périmètre

- Fusion du cerveau et de la voix (ADR et évals, fil Agent, après les lots « plus humaine »).
- Changer de modèle ou baisser la réflexion (Charles, 12/11 : on reste sur Grok 4.7).
- Affichage en deux temps du playground (fil Playground).
