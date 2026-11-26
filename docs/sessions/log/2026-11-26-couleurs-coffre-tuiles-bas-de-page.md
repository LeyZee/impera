# 2026-11-26 — Trois couleurs de contenu, fond des cartes, encart partagé, bas de page au téléphone — done
Fait : trois teintes de contenu en plus (`--nv-content-11` à `-13`), tenues en contraste dans les deux thèmes. Le fond des cartes d'un pli a son jeton (`--nv-tile-fill`), elles se détachent d'une plaque en Jour. Brique `nv-note`, l'encart d'une carte, avec ses variantes avertissement et danger. Au téléphone, une page ordinaire retire la hauteur de la carte d'installation : son bas ne passe plus sous la barre du bas.
Pas fait : brancher les écrans sur `nv-note` et sur les trois teintes (leurs fils s'en chargent).
Décisions : dans un encart teinté, les mots restent à l'encre et le ton est porté par un point devant le titre, comme l'étiquette teintée.
Découvertes : les lignes de « Ses liens » et quelques autres écrans composent leur fond à la main avec le même mélange ; elles peuvent prendre `--nv-tile-fill`.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, tests du design system et de la carte d'installation, mesure du bas de trois pages au téléphone sur la pile locale.
