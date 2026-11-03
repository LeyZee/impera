# 2026-11-03 — SC-01 lot b : rendu des cartons — in-progress
Fait : `domain/cards.ts` (contenu d'un carton, résumé de ce qu'il faut tourner, SVG pur en Jour et Nuit) ; `infra/card-rasterizer.ts` (PNG par ffmpeg et librsvg, polices du module seules) ; polices Geist et Instrument Serif en TTF avec leurs licences OFL ; route `GET /v1/script-structures/:structureId/cards/:segmentKey` (SVG, PNG dossier, PNG vignette) ; contrats `ScriptCardQuerySchema` et `script_card_not_found` ; copie des polices dans l'image Docker ; tests unitaires (dont instantané et palette contre `tokens.css`) et d'intégration (deux PNG identiques, largeur de la vignette, 404, chatteur sans accès).
Pas fait : écran Structures et structures de départ (lot c).
Décisions : pas de dépendance nouvelle (ffmpeg est déjà là pour `media`) ; TTF et non woff2, que librsvg ne dessine pas ; le SVG ne nomme ni fichier ni lien, la route l'envoie sous `default-src 'none'` ; thème par défaut selon le moment, « les deux » = Nuit.
Découvertes : aucune.
Vérifié : pnpm check, pnpm test, test d'intégration `script-structures` sur un Postgres 16 local.
