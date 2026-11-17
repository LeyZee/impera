# 2026-11-16 — CHF-01, recette du jeu, premier lot — in_progress
Fait : le défi du shift nomme son jour dans le fuseau du membre et dit « de net » (CHT-07, CHT-34) ; la vitrine rend le net réel vers le rang suivant et la jauge de « Mon rang » s'arrête à 99 % tant que le rang n'est pas noté (CHT-08) ; plusieurs rangs dus se dévoilent en un seul, le plus haut (CHT-09) ; le réglage des seuils dit une cause à la fois, sur le champ fautif (EQU-16) ; remarques de Design sur les rangs « Feu » : lueur de nuit gardée dans le dévoilement en Jour, faits de la fiche du membre en une colonne au téléphone, insigne gris dans le réglage tant que le champ est vide.
Pas fait : CHT-04, CHT-11, EQU-04 (ADR 0118, PR suivante) ; un dévoilement récapitulatif au-delà de deux gains (CHT-09, second point) : écran nouveau, à montrer à Design et à Charles avant de le coder.
Décisions : aucune.
Découvertes : `thresholdsTyped` et `thresholdFault` lisent les mêmes champs deux fois ; un test tient leur accord.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test (intégration en CI, pas de Docker dans la session).
