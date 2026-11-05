# SC-04 Descriptions des médias d'un script et validation rapide
Statut : blocked (clé de vision)
Phase : scripts (ADR 0056)
Dépend de : SC-02, le rôle `sense` (P3-04), ADR 0030 § 3
Branche : task/sc-04-script-descriptions

## Objectif
Chaque média d'un script et de chaque dépôt est décrit par le rôle `sense` ; l'agence valide étape par étape en quelques minutes ; l'identité du script est calculée.

## Contexte à lire
ADR 0056 § 6, ADR 0030 § 3, `docs/reference/media-vocabulary.md`, module `media`, PROPOSED-media-library (écran de la médiathèque).

## À faire
- [ ] Description à la réception de chaque média déposé (dépôts de l'ADR 0055 et scripts), une fois par empreinte et par version du descripteur.
- [ ] Écran de validation par étape (Extension) : vignettes floutées, description sous chacune, « Tout valider » pour l'étape, correction en ligne ; ressenti de la créatrice (`creator_note`) visible.
- [ ] Contrôle du moment : lumière de nuit dans un script de jour (ou l'inverse) en ambre.
- [ ] Couleur des cartons assortie à la tenue (choix de Charles, 03/11/2026, 15 h 57, « parfait applique ce que tu me recommandes », fil « Médias et scripts ») : au dépôt, la vision lit la couleur dominante de la tenue sur les photos et propose la palette lisible la plus proche (`SCRIPT_COLOR_PRESETS`, distance de teinte calculée en code, jamais par le modèle) ; la créatrice voit « Cartons en <nom>, assortis à ta tenue » avec « Garder » et « Changer » ; sans geste, la proposition s'applique. La couleur vaut pour ce script seul (la demande), la structure garde la sienne. Avant le tournage, les cartons sont dans la couleur de la structure.
- [ ] Identité du script (moment, ambiance, énergie, décor, à utiliser quand, à éviter quand) par schéma de sortie ; lue par l'agent et l'écran des chatteurs.

## Critères d'acceptation
- Tests : script non envoyable sans descriptions validées ; nouvelle génération n'écrase jamais une description validée.
- Aucun vrai média ni vraie description dans le dépôt.

## Hors périmètre
Les textes de vente (SC-05).

## Notes de session
