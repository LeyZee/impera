# SC-04 Descriptions des médias d'un script et validation rapide
Statut : in_progress (lots a, b, c1, c2, c3 fusionnés ; c4 en PR ; la vraie vision attend sa clé, ADR 0083 § 9)
Phase : scripts (ADR 0056)
Dépend de : SC-02, le rôle `sense` (P3-04), ADR 0030 § 3
Branche : task/sc-04-script-descriptions

## Objectif
Chaque média d'un script et de chaque dépôt est décrit par le rôle `sense` ; l'agence valide étape par étape en quelques minutes ; l'identité du script est calculée.

## Contexte à lire
ADR 0083 (tout dépôt décrit en détail, seul, règle solo, étapes et synthèse), ADR 0056 § 6, ADR 0030 § 3, `docs/reference/media-vocabulary.md`, module `media`, PROPOSED-media-library (écran de la médiathèque).

## À faire
- [x] Description à la réception de chaque média déposé (dépôts de l'ADR 0055 et scripts), une fois par empreinte et par version du descripteur (lot a, migration 0141 ; interrupteur par créatrice, éteint par défaut).
- [x] Lot b : description de chaque étape d'un script et synthèse (rôle `brain`, prix de la grille, jamais du modèle ; migration 0145, job `content_drops.summarize_script`).
- [x] Lot c1 : interrupteur par créatrice côté serveur (propriétaire seul), rattrapage à son allumage et chaque heure, redescription quand la version du prompt change (jamais par-dessus une description humaine), synthèse refaite après une correction ou un nouveau prompt.
- [x] Lot c2 : colonnes de validation (`validated_by` vers `user`, pas `team_members` : le propriétaire n'a pas de fiche d'équipe ; ADR 0030 § 3 amendé, « ok phrases 0030 » de Charles le 08/11 à 21h03), migration 0152, lecture, validation, correction en ligne et validation de la synthèse côté serveur ; la redescription épargne les descriptions validées.
- [x] Lot c3 : l'interrupteur à l'écran (Créatrices › Scripts, propriétaire seul).
- [x] Écran de validation par étape (lot c3, Créatrices › Scripts › « Relire les descriptions ») : description sous chaque média, « Tout valider » pour l'étape, une description à vérifier validée seule, correction en ligne ; ressenti de la créatrice visible ; la synthèse avec « Prix à fixer » à côté de chaque étape, la raison `price` en ambre ; resynthèse après une correction.
- [x] Lot c4 (accepté par Charles le 08/11 à 21h51, interrupteur précisé à 22h00) : vignette de chaque photo et vidéo (migration 0158, job `content_drops.make_thumbnail`, rattrapage chaque heure), gardée après l'effacement de l'original ; routes vignette et média (propriétaire, manager actif ; lecture par plages pour la vidéo ; chaque ouverture journalisée) ; dans la relecture, la vignette de chaque média et, au clic, le média en grand avec sa description, Valider, Corriger ; les descriptions validées dans la fiche du ZIP ; interrupteur « Flou des médias » (œil barré quand flouté), flouté à la première ouverture, choix gardé par navigateur.
- [ ] Reste de l'écran : synthèse corrigée à la main, prix de la grille quand P6-01 existe.
- [ ] Contrôle du moment : lumière de nuit dans un script de jour (ou l'inverse) en ambre.
- [ ] Couleur des cartons assortie à la tenue (choix de Charles, 03/11/2026, 15 h 57, « parfait applique ce que tu me recommandes », fil « Médias et scripts ») : au dépôt, la vision lit la couleur dominante de la tenue sur les photos et propose la palette lisible la plus proche (`SCRIPT_COLOR_PRESETS`, distance de teinte calculée en code, jamais par le modèle) ; la créatrice voit « Cartons en <nom>, assortis à ta tenue » avec « Garder » et « Changer » ; sans geste, la proposition s'applique. La couleur vaut pour ce script seul (la demande), la structure garde la sienne. Avant le tournage, les cartons sont dans la couleur de la structure.
- [ ] Identité du script (moment, ambiance, énergie, décor, à utiliser quand, à éviter quand) par schéma de sortie ; lue par l'agent et l'écran des chatteurs.

## Critères d'acceptation
- Tests : script non envoyable sans descriptions validées ; nouvelle génération n'écrase jamais une description validée.
- Aucun vrai média ni vraie description dans le dépôt.

## Hors périmètre
Les textes de vente (SC-05).

## Notes de session
- 08/11/2026 (lot a) : prompt `sense/creator-drop.md`, `describeDrop` dans la passerelle, contrôle des renvois et du « seule » en code, migration 0141 (`author`, `creator_note`, `review_reasons`), job `content_drops.describe_file`. Testé avec une vision fixe ; la vraie vision attend sa clé.
- 08/11/2026 (lot b) : prompt `brain/script-summary.md`, `summarizeScript` dans la passerelle, migration 0145 (`script_drop_summaries`), job `content_drops.summarize_script` mis en file à l'envoi et après chaque description ; étapes tenues par le code, prix redemandé une fois puis gardé en ambre. Testé avec un cerveau fixe.
- 08/11/2026 (lot c1) : `GET`/`PUT /v1/creators/:creatorId/drop-descriptions`, job `content_drops.describe_backlog` (chaque heure et à l'allumage), `promptHashes` dans la passerelle ; la redescription « des seules non validées » attend les colonnes de validation (c2) : d'ici là, seule une description humaine en protège un média.
- 08/11/2026 (lot c2) : migration 0152 (`validated_by`, `validated_at` sur `media_descriptions` et `script_drop_summaries`, déclencheur `refuse_description_change`, `nirvana_app` limité aux deux colonnes du tampon) ; `GET …/drops/:id/descriptions`, `POST …/descriptions/validate`, `…/descriptions/correct`, `…/summary/validate` (propriétaire, manager actif). La validation depuis l'espace de la créatrice reste à faire avec son écran. Critère « script non envoyable sans descriptions validées » : côté agent (P6-01), pas encore branché.
- 08/11/2026 (lot c4) : migration 0158 (`media_assets.thumbnail_key`, `thumbnailed_at`), ffmpeg réduit l'image (première image parlante d'une vidéo), sans métadonnées, une seule tentative ; `GET …/drops/:id/files/:fileId/thumbnail` et `…/media` (plages `Range`, 416 au-delà, `media.opened` au journal). ADR 0030 § 4 amendé : la vignette a sa colonne `thumbnail_key`, `storage_key` ne désigne que l'original. La médiathèque n'a pas encore d'écran : elle réutilisera ces routes.
