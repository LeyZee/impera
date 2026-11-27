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
- [x] Avenant du 20/11 à l'ADR 0145 § 5 (demande de Charles) : le coffre ne montre que ce qui est dans Impera ; « Synchroniser » ouvre « Choisir dans Reveal » (dossiers en cartes, cocher entier ou média par média, « Importer ») ; « Retirer d'Impera » confirmé ; le flou suit le menu partout. Lot de captures `coffre-choisir-1`.

## Critères d'acceptation
- Tests de l'app web sur les états (à décrire, à valider, validé, flux illisible) ; captures Nuit/Jour, PC/téléphone avant fusion.

## Hors périmètre
Écriture des textes (rôle `script_writer`), appel d'écriture Reveal.

## Notes de session
- 16/11/2026 (Médias, demande de Charles) : en attendant cet écran, Créatrices › Scripts porte la carte « Son coffre Reveal » : dernière synchro, médias, dossiers et dossiers « À classer » (sans ☀️ ni 🌙), la liste des dossiers dans l'ordre de Reveal, et « Synchroniser le coffre » pour le propriétaire seul. La médiathèque (lot a) la remplacera ou la reprendra.
- 16/11/2026, suite (Médias, lot medias-coffre-2 refusé par Charles) : la carte s'ouvre dossier par dossier (`?dossier=`, fil d'Ariane « Coffre / dossier »), chaque dossier en mosaïque de ses aperçus floutés (blurhash de Reveal, migration 0219), les médias d'un dossier en grille, la fiche du média (texte et prix suggéré de Reveal, date d'ajout). L'aperçu net (ADR 0138) se lit à la demande par `GET /v1/creators/:creatorId/vault/media/:platformMediaId/preview`, propriétaire et manager actif, jamais gardé. Reste du lot a : « décrits / à décrire », correction et « Valider » (après `fetchMedia`) ; choix de synchro par dossier ou par média, à placer avec la description par la vision.
