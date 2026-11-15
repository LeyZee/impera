# AUT-01 L'agent tient compte des automatisations de Reveal
Statut : in_progress
Phase : exploitation
Dépend de : ADR 0110
Branche : claude/project-thread-3v86b0 (branche imposée par la session)

## Objectif
Appliquer l'ADR 0110 : l'agent ne répond jamais par-dessus une réponse déjà faite sur la plateforme, et il reconnaît les messages écrits par les automatisations de Reveal (accroche, bienvenue, réponse à une story, Mass DM, rappel d'expiration).

## Contexte à lire
ADR 0110, ADR 0006, ADR 0007, `docs/reference/reveal-connector-inventory.md`, `docs/reference/reveal-api-observed.md`, modules `conversations` et `connectors/infra/reveal`.

## À faire
- Lot 1 (sans capture) : règle 2, un message côté créatrice qui n'est pas de l'agent, arrivé pendant que le fan attend l'agent, fait tomber le brouillon et remet la conversation au repos (`answersFan` sur `message_received`, commande `answered_on_platform`). Exception : un signe du filet de sécurité dans ses messages en attente, ou un épisode de soin ouvert.
- Lot 2 (après la capture sur le PC, compte fan test seul, aucun Mass DM envoyé) : origine du message dans `ExternalMessage` (accroche, bienvenue, story, Mass DM, automatisme), terme au glossaire ; règles 1, 3, 4, 5 dans le contexte du cerveau ; règle 6 sur les relances.

## Résultat
- Lot 1 : fait (tests unitaires de projection, tests d'intégration du module conversations).
- Lot 2 : attend la capture.
