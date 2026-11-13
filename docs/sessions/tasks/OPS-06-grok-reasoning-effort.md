# OPS-06 Grok 4.7 réfléchit moins longtemps que ses délais
Statut : done
Phase : exploitation
Dépend de : ADR 0009, OPS-05
Branche : task/ops-06-grok-reasoning-effort (fil « Bilan »)

## Objectif (1 phrase)

Que le cerveau, la voix et le juge répondent dans leur délai avec Grok 4.7, qui réfléchit par défaut près d'une minute.

## Contexte à lire (fichiers précis)

- `packages/llm/src/config.ts`, `packages/llm/src/call-runner.ts`.
- `docs/reference/llm-providers.md`.

## À faire (liste vérifiable)

- [x] `reasoningEffort` par rôle dans la configuration (`low`, `medium`, `high`), envoyé à xAI seulement (`providerOptions.xai`).
- [x] Défauts : `low` pour `brain`, `voice` et la bascule de `sense` ; `medium` pour `judge`.
- [x] Test de la passerelle : l'option part chez xAI, jamais chez Mistral.
- [x] Mesure sur le PC avec `pnpm evals --key-from-crm` (12/11) : cerveau médiane 18 s, voix 11 s, juge 34 s, chacun sous son délai. Les échecs restants de la suite smoke ne viennent pas de ce réglage (consigne du brief, gardes strictes, juge sans la situation : ADR 0090 et OPS-07).

## Critères d'acceptation (tests, commandes, comportements observables)

- Un scénario d'évaluation passe sans « le cerveau n'a pas répondu ».
- Les notes du juge restent au-dessus des seuils de `evals/thresholds.json`.
- `pnpm check` et la CI verts.

## Hors périmètre

- Relever les délais : un fan n'attend pas une minute.
