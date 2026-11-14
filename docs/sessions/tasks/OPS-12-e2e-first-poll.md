# OPS-12 Le premier relevé répond aux messages frais
Statut : done
Phase : exploitation
Dépend de : P2-02
Branche : task/ops-12-e2e-first-poll (fil « Bilan »)

## Objectif (1 phrase)

Que `main` repasse au vert et qu'un fan qui écrit juste avant le premier « Sync » d'un compte reçoive sa réponse.

## Contexte à lire (fichiers précis)

- `apps/api/src/modules/connectors/application/poll.ts` (`CATCH_UP_AFTER_HOURS`).
- `apps/api/src/__tests__/e2e/phase0.e2e.test.ts`, `apps/api/src/__tests__/connectors.integration.test.ts`.

## Cause

P2-02 (#715) traitait tout message lu au premier relevé d'un compte comme rattrapé : ni fiche lue, ni réponse. Le test e2e de la phase 0 part d'un compte jamais relevé : son message de fan n'avait donc plus de brouillon, et `main` est rouge depuis la fusion.

## À faire (liste vérifiable)

- [x] Le premier relevé suit la même règle que les suivants (proposition d'Agent) : un message de plus de 6 h est rattrapé, un message frais est lu et répondu. Le relevé lit toujours la dernière journée une seule fois.
- [x] Tests d'intégration : historique vieux de 10 h rattrapé au premier relevé, message frais au premier relevé répondu, message rattrapé signalé par le filet répondu.
- [x] Glossaire et flux des messages à jour.

## Critères d'acceptation (tests, commandes, comportements observables)

- Le job « Tests (unit + integration) » est vert sur la PR, test e2e compris, sans changer ce test.

## Hors périmètre

- La durée de 6 h, inchangée.
