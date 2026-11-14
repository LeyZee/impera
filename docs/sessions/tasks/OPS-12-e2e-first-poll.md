# OPS-12 Le test de bout en bout part d'un compte déjà relevé
Statut : done
Phase : exploitation
Dépend de : P2-02
Branche : task/ops-12-e2e-first-poll (fil « Bilan »)

## Objectif (1 phrase)

Que `main` repasse au vert : le test e2e de la phase 0 échoue depuis la fusion de P2-02 (#715).

## Contexte à lire (fichiers précis)

- `apps/api/src/__tests__/e2e/phase0.e2e.test.ts`.
- `apps/api/src/modules/connectors/application/poll.ts` (premier relevé = rattrapage, P2-02).

## Cause

Depuis P2-02, le premier relevé d'un compte rattrape son historique sans y répondre. Le compte du test n'avait jamais été relevé : le message du fan arrivait donc comme rattrapé, aucun brouillon n'était fait, et le test interrogeait la conversation jusqu'à recevoir une erreur.

## À faire (liste vérifiable)

- [x] Le compte du test est créé déjà relevé une fois (`last_poll_at` une minute avant) : le message du fan est frais, ce que le test veut vérifier.

## Critères d'acceptation (tests, commandes, comportements observables)

- Le job « Tests (unit + integration) » est vert sur la PR, test e2e compris.

## Hors périmètre

- Le comportement du premier relevé, inchangé (P2-02 ; il a ses propres tests dans `connectors.integration.test.ts`).
