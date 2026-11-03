# 2026-11-03 — SC-01 lot c2 : écran Créatrices › Structures — in-progress
Fait : l'atelier à l'écran (`apps/web/src/scripts/`) : bibliothèque, duplication de la structure de départ, édition du nom, du moment, de la couleur (24 palettes ou libre) et de chaque étape et pont, aperçu du carton et de la vignette en direct par `POST /v1/script-structures/cards/preview` ; champs d'étape `outfit` et `place` ; fiches SC-07 (mode tournage), SC-08 (photo d'exemple), SC-09 (séries proposées par l'IA) ; glossaire « Tenue », « Lieu ».
Pas fait : glisser-déposer de la pile ; file de structures par créatrice (lot c3).
Décisions : l'aperçu est dessiné par le serveur (le même code que le vrai carton), jamais copié dans la page : montré par `<img src="data:image/svg+xml,…">`, donc rien n'y tourne ; l'écran valide le brouillon avec le contrat pour refuser au même endroit que le serveur ; réordonner par boutons et Alt + flèches d'abord (accessible au clavier), le glisser viendra par-dessus.
Découvertes : aucune.
Vérifié : pnpm check, tests web (modèle et atelier), tests du module scripts, captures Nuit et Jour à 1 440 et 400 px sur des données inventées.
