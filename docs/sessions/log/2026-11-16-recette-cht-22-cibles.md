# 2026-11-16 — Recette du 16/11 : cibles tactiles des petits liens (CHT-22), et R1 retirée — done

Fait : « Mes chiffres » (Aujourd'hui) et « Ta commission est dans Commissions » (Mes rapports) gardent leur taille de texte et prennent une cible de 44 px, par une classe commune `nv-hit` du design system. « Voir tout » des Trophées avait déjà sa cible (CRE-14). Tests : la règle dans le design system, la classe sur les deux liens.
Pas fait : rien.
Décisions : R1 (CHT-01, CRE-08, lire le fuseau de l'agence ou de la fiche au lieu de celui de l'appareil) est retirée, son commit est annulé sur la branche. Charles a tranché le 16/11 : un chatteur et une créatrice lisent l'heure locale de leur appareil, là où ils se trouvent. CHT-01 et CRE-08 ne sont donc plus des anomalies.
Découvertes : quand une heure posée par l'agence diffère de l'heure locale du lecteur, rien ne le rappelle à l'écran ; à décider avant d'ajouter quoi que ce soit.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test (voir la PR).
