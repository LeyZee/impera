# 2026-11-26 — INS-05 : le propriétaire répond à la place de la créatrice

- Fiche : INS-05 (écran du propriétaire).
- Fait : `expiresAt` dans la question lue ; DecisionStack accepte un nom et un avatar, une échéance (ambre sous 2 h), une note et l'absence de « Plus tard » ; carte « N questions sans réponse » sur le Dashboard, en tête seulement quand une question finit bientôt, sinon sous « Objectif du jour », 640 px au PC ; tests de l'échéance, de la carte et des deux positions. Lignes de liens de Trafic sur `--nv-tile-fill` (retouche de Design). La légende IA ignore un média marqué « À refaire » (filtre `redo_sentence is null`, test d'intégration).
- Captures : lots `repondre-a-sa-place-1` puis `repondre-a-sa-place-2` (retouches de Design), Nuit/Jour, PC/téléphone.
- Reste : validation des captures par Charles ; ses anciennes légendes en exemples ; publication après le réglage Meta.
- Découvertes : la brique nv-avatar ne cadre pas une image (Design la reprend).
