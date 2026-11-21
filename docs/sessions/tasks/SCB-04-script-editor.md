# SCB-04 Éditeur des scripts à branches
Statut : in_progress (lot 1 serveur #873, lot 2 reconnaissance #884, lot 3 écran #896, ADR 0161 et retrait de la carte des scripts Reveal, 20/11/2026)
Phase : scripts (ADR 0112, amendement du 19/11, §§ 20-26)
Dépend de : SCB-01 (#814), onglet Scripts de la fiche créatrice (ADR 0149) pour l'écran
Branche : claude/project-thread-moagsx

## Objectif
L'agence écrit un script à branches dans Impera, voit ce qui lui manque, le rend « prêt à copier », le recopie à la main dans Reveal ; l'import suivant le reconnaît et lui transfère conditions, messages et rythme. Une vue Performances dit ce que chaque script rapporte.

## Contexte à lire
ADR 0112 (§§ 13, 14, 20-26), ADR 0145 (coffre), ADR 0149 (fiche créatrice), module `scripts` (README), fiche SCB-01.

## À faire
- [x] Lot 1 serveur : table `prepared_scripts` (migration 0229, RLS forcée, fermée au compte de la créatrice), manques et refus comptés à chaque lecture, avertissements de prix, états `editing` → `ready_to_copy` → `matched`, routes `…/prepared-scripts` (création idempotente, enregistrement sur révision, prêt à copier sans manque), journal d'audit.
- [x] Lot 2 : reconnaissance à l'import (correspondance exacte nom, étapes, branches par rang, médias, prix), ordre et conditions transférés (`platform_script_branches`, migration 0230), script fermé, `copyDifferences` à la lecture.
- [ ] Teaser, messages après le média et rythme : lus sur le script fermé par le déroulé à branches (lot 3 du moteur, fil Agent).
- [x] Lot 3 : écran de l'onglet Scripts (`apps/web/src/creators/scripts/prepared/`) : vues « Scripts » (liste, « Nouveau script », éditeur enregistré tout seul sur la révision lue, manques et avertissements du serveur, chemins et prix de chaque chemin) et « À copier dans Reveal » (textes et prix à copier, médias dans l'ordre, ce qui diffère encore), puis l'écran d'avant (scripts envoyés).
- [x] ADR 0161 (seulement nos scripts, Impera vers Reveal) : la carte « Ses scripts dans Reveal » quitte l'onglet ; un script reconnu s'affiche « Dans Reveal ».
- [ ] Côté agent (fil Agent) : n'offrir qu'une copie reconnue, avec la description de notre script ; retirer alors les routes d'identité des scripts natifs ; reconnaissance sans doublon ni séquence antérieure (ADR 0161 § 6) ; ordre des descriptions (§ 7).
- [ ] Lot 4 : vue Performances (lecture serveur puis écran).
  - [x] 4 a : garder les totaux de Reveal par étape à chaque import (`platform_script_step_daily`, ADR 0129 § 12).
  - [ ] 4 b : relevé quotidien automatique (accès de plus du rôle de service, avis de Sécurité).
  - [ ] 4 c : bilan d'un script sur 30 jours (démarrages, achat par étape, argent rapporté) et sa route.
  - [ ] 4 d : vue sous chaque script dans « Ses scripts », captures et avis de Design.

## Critères d'acceptation
- Domaine en unitaire ; intégration : création rejouée, conflit, compte refusé, révision périmée, manques → 422, script fermé, isolation (chatteur, compte de la créatrice, manager hors liste) ; balayages d'isolation, d'authentification et d'origine verts.
- Aucune donnée réelle ; aucune méthode, aucun seuil d'agence dans le dépôt.

## Hors périmètre
Écriture d'un script chez Reveal (jamais), choix de la branche par l'agent (lot 2 du moteur), `script_writer`.
