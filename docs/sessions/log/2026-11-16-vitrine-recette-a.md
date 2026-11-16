# 2026-11-16 — Vitrine : correctifs de la recette (PR A)

- **Tâche** : PROPOSED-trophy-case (suite, recette du 16/11).
- **Fait** : CHT-18 (silhouette pendant la lecture, message « Ta vitrine n’a pas pu être lue. » et « Réessayer » au lieu d'une page blanche, chatteur et créatrice) ; CHT-19 (entrée en cascade une fois par session, drapeau `sessionStorage` dans un try/catch, jamais dépensé par la vue de l'agence) ; CHT-20 (la fenêtre `Dialog` prend elle-même le focus quand elle n'a que sa croix, Échap la ferme, Tab reste dedans) ; CRE-14, partie écran (étagère du téléphone en rangées pleines de trois, « Voir tout » seulement au-delà d'une rangée cachée, cible de 44 px).
- **Tests** : `arrange.test.ts`, `TrophyCaseView.test.tsx`, `trophy-case.css.test.ts`, `HerTrophiesPage.test.tsx`, `shell/Dialog.test.tsx` (nouveau).
- **Captures** : recette/2026-11-16/vitrine-recette-a-2 (14 images).
- **Découvertes** : « Encore N livraisons à l'heure » répète le nom de l'objet (creator-case.tsx, fil Badges).
- **Reste** : PR B après #772 (insigne de rang, ligne « Premier rang », étagère Médailles vide de CHT-17).
