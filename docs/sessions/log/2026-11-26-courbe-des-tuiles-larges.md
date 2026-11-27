# 2026-11-26 — La courbe d'une tuile large va jusqu'au bord — done
Fait : dans une tuile à courbe (`nv-stat__spark`) plus large que son viewBox, le trait s'arrêtait à 300 px alors que le fond continuait. Le tracé se termine maintenant sur un motif sans vide, et sans mouvement il n'a plus de tiret du tout : le trait atteint le bord à toute largeur.
Pas fait : rien.
Décisions : une animation propre à la tuile (`nv-stat-draw`) plutôt que de toucher `nv-draw`, que les grands graphiques partagent et qui n'ont pas ce défaut (pas de trait à épaisseur fixe).
Découvertes : aucun composant partagé pour la tuile à courbe ; le Dashboard l'écrit à la main et une maquette l'a recopiée. Un composant `Stat` éviterait la prochaine copie.
Candidats à suppression : aucun.
Vérifié : tests du design system ; mesure du bout du trait à 300, 600 et 880 px de large, avec et sans mouvement, sur la feuille de style réelle.
Ajout du même jour : le test `cards-titles.css.test.ts` relisait chaque feuille de style pour chaque carte et a dépassé sa limite de 20 s en CI. Chaque feuille est lue une fois et les règles d'une carte sont gardées : 12 s deviennent 1 s, mêmes contrôles.
