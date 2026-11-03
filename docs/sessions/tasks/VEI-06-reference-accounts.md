# VEI-06 Comptes de référence par Business Discovery
Statut : blocked (compte pro de l'agence relié à une page Facebook, revue de Meta)
Phase : veille (ADR 0060)
Dépend de : VEI-01
Branche : task/vei-06-reference-accounts
Propriétaire : Bilan (connecteur)

## Objectif
Une liste de comptes de référence choisie par l'agence, lue chaque jour ; un post qui dépasse nettement la moyenne de son compte devient un signal.

## Contexte à lire
ADR 0060 § 2 (source 3), documentation Business Discovery de Meta au moment du lot.

## À faire
- [ ] Faux d'abord ; branchement du compte de l'agence par la voie Facebook Login ; jeton scellé (ADR 0016).
- [ ] Liste de comptes réglée par l'agence ; comptes à âge restreint signalés comme illisibles.
- [ ] Débit borné : les appels Business Discovery comptent dans la limite horaire de l'application Meta.

## Critères d'acceptation
- Tests contre le faux ; seuil de dépassement réglable.

## Hors périmètre
Hashtags (pas une source de l'ADR 0060).

## Notes de session
