# P2-06 Déploiement du connecteur Reveal

Statut : todo
Phase : 2
Dépend de : P2-05
Branche : task/p2-06-reveal-deployment

## Objectif
Le connecteur tourne 24 h sur 24 sur un serveur, sorti par une IP française stable, sans que le navigateur de Charles soit ouvert.

## Contexte à lire
ADR 0008 ; `docs/architecture/threat-model.md` ; `docs/reference/reveal-connector-spec.md` § 3 ; runbooks d'exploitation.

## À faire
- Choix du serveur et de l'IP de sortie à faire valider par Charles (coût), `connector_config.egress`.
- Secrets (`SESSION_ENCRYPTION_KEYS`, `EXTENSION_DEVICE_TOKEN`), sauvegardes et restauration testées.
- Surveillance : alertes session expirée, coupe-circuit, `shape_changed`.

## Critères d'acceptation
- Le compte est relevé pendant 48 h sans intervention, en lecture seule, puis écriture activée par Charles seulement.

## Hors périmètre
Toute autre plateforme.

## Notes de session
