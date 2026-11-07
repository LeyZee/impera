# 2026-11-07 — La liste d'équipe Reveal relue chaque heure (ADR 0076 § 5, § 6)

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : coordinateur (reste noté de l'ADR 0076)

## Fait

- La lecture des ventes (`connector.read_sales`) relit `/v1/chatters` une fois par heure et par plateforme (`WATCH_TEAM_MS`), comme elle relit les modèles tous les quarts d'heure. Ce qu'elle voit est gardé par `recordReading`, la même règle que la revue : une liste vide ou réduite de moitié fait une seule alerte « lecture anormale ». Un retrait ou un nouveau venu apparaît donc dans l'heure, sans attendre qu'on ouvre la revue ou Réglages.
- Un appel de plus par heure, sous la limite générale de Reveal ; aucun appel aux statistiques.
- Test d'intégration : un retrait vu par la lecture des ventes, sans écran ouvert, et une seule lecture de la liste dans l'heure.

## Reste

- Le compte du membre « bot » de la session capturée n'est toujours pas connu par son `chatterId` (ADR 0050 § 5).

## Découvertes

- Aucune.
