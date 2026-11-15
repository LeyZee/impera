# Coffre Reveal : écran médiathèque et composition de scripts
Statut : proposed (ID à donner ; ADR 0099 et 0100 ; propriétaire proposé : Médias, avec l'app web)
Phase : 6
Dépend de : `PROPOSED-vault-sync.md`, `PROPOSED-vault-fetch-media.md`, `PROPOSED-vault-import-scripts.md` ; création réelle après `PROPOSED-vault-script-write.md`
Branche : task/<id>-vault-screen

## Objectif
L'agence voit le coffre de chaque créatrice rangé comme dans Reveal, valide les descriptions, compose un script avec les médias du coffre (ou relit celui écrit par l'IA) et choisit « Créer dans Reveal ».

## Contexte à lire
ADR 0099, ADR 0100, ADR 0083, ADR 0086 (forme de la mesure), `PROPOSED-media-library.md` (§ Écran, déjà détaillé), règles DESIGN du projet (aucun contrôle natif, `Select` partagé, une carte par sujet, rouge urgences, ambre avertissements).

## À faire
Trois lots, une PR chacun : (a) médiathèque, (b) composition, (c) relecture IA, interrupteur et mesure.
- [ ] Nom de l'onglet à soumettre à Charles : « Médias » se confond avec « Contenu ».
- [ ] Routes de validation par média au harnais d'isolation.
- [ ] Créatrices › Médias : grille par dossier dans l'ordre de Reveal, « décrits / à décrire » par dossier, vignettes floutées par défaut, fiche du média avec correction et « Valider ».
- [ ] Composer un script : choisir des médias synchronisés et décrits, ordre par défaut celui de Reveal, prix depuis la grille de l'agence, « Prix à fixer » tant qu'elle n'existe pas ; nom d'un script composé fixé à part des `S0NN` des scripts tournés (remarque Médias, point 6).
- [ ] Relire un script écrit par l'IA : garder, retoucher, refuser ; « Créer dans Reveal ».
- [ ] Interrupteur « création sans relecture » par créatrice, propriétaire seul, dans Créatrices › Scripts, avec la mesure gardé / retouché / refusé à la manière de 0086 (remarque Médias sur 0100, point 5).
- [ ] Rien pour une créatrice archivée.

## Critères d'acceptation
- Tests de l'app web sur les états (à décrire, à valider, validé, flux illisible) ; captures Nuit/Jour, PC/téléphone avant fusion.

## Hors périmètre
Écriture des textes (rôle `script_writer`), appel d'écriture Reveal.

## Notes de session
