# SC-08 Photo d'exemple par étape
Statut : todo (idée acceptée par Charles le 03/11/2026, 13 h 38)
Phase : scripts (ADR 0056)
Dépend de : SC-03 (médiathèque des scripts), CR-06 (stockage objet)
Branche : task/sc-08-stage-example-photo

## Objectif
La créatrice voit le cadrage attendu au lieu de le deviner : l'agence attache à une étape une photo d'exemple, qu'elle voit dans l'application.

## À faire
- [ ] L'agence choisit une photo d'exemple par étape dans l'atelier (une image de la médiathèque de l'agence, jamais une photo d'une autre créatrice sans son accord).
- [ ] La créatrice la voit sur le carton dans l'application et en mode tournage (SC-07). Elle n'apparaît **jamais** sur le carton exporté ni dans le dossier envoyé à Reveal : le SVG d'un carton ne nomme toujours aucune image (ADR 0064).
- [ ] Les métadonnées de la photo sont retirées (ADR 0055) ; elle reste dans l'espace de l'agence.
- [ ] Relecture Bilan (stockage, droits) et Extension (écran).

## Critères d'acceptation
- Tests : la photo d'exemple n'entre pas dans le PNG ni dans l'export ZIP ; seule la créatrice à qui le script est demandé la voit.

## Notes de session
