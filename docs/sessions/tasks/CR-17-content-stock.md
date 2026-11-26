# CR-17 Coffre Impera : ce qu'elle dépose, compté par usage, ouvert en grand et décrit

Statut : in_progress (vue de stock, cadeaux baleines, descriptions relues par les trois : en PR ; « À remplacer » après le serveur du module des dépôts)
Phase : espaces (ADR 0163)
Dépend de : CR-06 (dépôts), ADR 0159 (cadeaux), ADR 0161 (scripts) ; « À remplacer » : le serveur du module des dépôts, puis la propagation du module des scripts
Branche : claude/project-thread-660krh

## Objectif

L'agence (PC) et la créatrice (téléphone) voient d'un coup d'œil ce qu'il reste d'avance par usage, ouvrent chaque média en grand et relisent sa description, sur la même vue.

## Contexte à lire

`docs/adr/0163-coffre-impera-content-stock.md` (fait foi), ADR 0055, ADR 0044, ADR 0159, ADR 0161, `docs/design/README.md` (la règle d'écran).

## À faire

- [x] Catégorie `whale_gift` (contrats, base, demandes) ; garde « pas un cadeau » pour un média d'une autre catégorie.
- [x] `GET /v1/creators/:creatorId/stock` (propriétaire, manager) et `GET /v1/creator-space/stock` (elle) : catégories, jours d'avance, manque, médias avec leur état.
- [x] Descriptions, vignette et média par la porte de la créatrice ; valider et corriger à son nom ; politiques restrictives ; balayage d'isolation.
- [x] Écrans : Créatrices › Médias › « Coffre Impera » ; Contenu › « Mon coffre » ; visionneuse (photo, vidéo, son), flou respecté, flèches et clavier.
- [x] Captures nuit/jour, PC/téléphone, relues par Design (`recette/2026-11-21/coffre-impera-2/`).
- [ ] « À remplacer » (ADR 0163 § 6) : pastille ambre, compteur et filtre, « À refaire » côté agence, « Remplacer » côté elle, une fois les routes du module des dépôts fusionnées ; captures avant fusion.
- [x] Meter à marque, Ring et couleurs de catégorie du design system à la place des dessins locaux.
- [ ] Jetons `--nv-content-11` à `13` (vidéos à vendre, deux vocaux) à la place des mélanges provisoires, quand Design les livre.
- [x] Catégories « Vocal du bip », « Vocal bien réelle », « Vidéos à vendre » (contrats, base, demandes, coffre).
- [x] Ce que l'agent pioche et note (`content-drops` › `reserved`) : un vocal une fois par fan, un cadeau jamais deux fois, seulement validé ; index unique partiel sur `media_sends` (`reserved-media.integration.test.ts`).
- [ ] Type de vidéo à vendre choisi au dépôt, quand les lignes « Vidéos déjà tournées » de Sur mesure sont sur main.
- [ ] « Ce qui part quand » : attend le moteur de publication.

## Critères d'acceptation

- Un chatteur, un autre compte et une autre créatrice reçoivent 403 ou 404 sur chaque route (fait, `content-stock.integration.test.ts`).
- Les chiffres de l'en-tête, du donut, des cartes et de la vue catégorie viennent de la même liste (fait).
- Elle ne voit jamais de rouge ; l'ambre seulement sur un manque réel d'une plateforme ouverte (fait).
