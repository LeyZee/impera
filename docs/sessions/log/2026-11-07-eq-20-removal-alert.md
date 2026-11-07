# 2026-11-07 — EQ-20 : l'alerte de retrait (ADR 0076 § 5) dans Équipe › Membres

Fait :
- Contrats : `TeamPlatformRemovalListSchema`, la réponse de `GET /v1/team/platform-removals`.
- `team` : port `PlatformRemovals`, branché par le composition root sur `connectors.teamRemovals` (#626) ; la route lit pour le propriétaire et les comptes de l'équipe, et `connectors` décide de ce que chacun voit (propriétaire et managers actifs ; liste vide pour un chatteur).
- Écran : pastille ambre « Retiré de Reveal » à côté du statut sur la ligne du membre ; sur sa fiche, une ligne ambre (« Retiré de Reveal le 5 nov., toujours actif chez Impera. Son lien reste, ses ventes passées lui restent attribuées », et « son départ se fait par « Changer le statut » » pour le propriétaire seul). Rien n'est dit tant que la liste ne se lit pas : la liste des membres tient sans elle.
- Tests : intégration `team-members` (propriétaire et manager voient le retrait, chatteur liste vide, créatrice 403, plus rien après effacement) ; écran `MembersPage` (pastille, ligne datée pour le propriétaire, ligne sans date et sans geste pour un manager).

Reste : captures Nuit/Jour, ordinateur/téléphone, vues par Charles avant fusion ; la route d'invitation (petite PR de Bilan).

Découvertes : aucune.
