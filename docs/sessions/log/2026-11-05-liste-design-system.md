# 2026-11-05 — La liste du design system remplace les listes du système

- **Fiche** : D-01 (design system), consigne de Charles du 05/11 : aucun contrôle du système, ni liste ni sélecteur de date natifs.
- **Fait** : `Select` (`apps/web/src/shell/Select.tsx`, styles `nv-select*` dans le design system) : champ qui dit le choix, liste sur sa propre plaque opaque, clavier complet (flèches, Début, Fin, Entrée, Échap qui ne ferme pas le dialogue autour, premières lettres), groupes, ligne discrète sous un choix (« relié à @lune »), recherche sans accents au-delà de dix choix. La liste est posée en haut de la page (ou du dialogue) sous son champ, au-dessus quand la place manque. Douze écrans convertis, tests compris (`@/test/select` : `choose`, `chooseValue`, `openList`, `valuesOf`).
- **Captures** : à produire par groupe d'écrans, dans les fils que le coordinateur ouvre.
- **Reste** : les dates (`DayField` d'Équipe partagé, option dates passées pour la date de naissance), PR à part.
- **Découvertes** : le planning n'avait plus de liste depuis #564 (puces `nv-chip`) ; une agence avec beaucoup de membres pourrait vouloir `Select` à la place, c'est un choix d'interface à poser à Charles avec Équipe.
