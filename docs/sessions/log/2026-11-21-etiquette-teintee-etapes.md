# 2026-11-21 — Étiquette teintée, piste d'étapes partagée, champ en saisie allégé — done
Fait : `nv-tag--tint`, une étiquette qui porte la couleur de sa catégorie (fond léger et point plein, mots à l'encre). `<Steps>` et `nv-steps` rejoignent les figures partagées : des pastilles reliées par un trait, cochées quand l'étape est atteinte, un halo sur l'étape en cours, le mot et l'heure sous chacune. Le champ où l'on écrit garde sa plaque, avec un contour fin à l'encre et un halo doux (choix de Charles sur carte, 21/11), au lieu du cadre sombre sur fond gris.
Pas fait : passer les deux écrans qui dessinaient leur piste à la main sur `<Steps>` (leurs fils s'en chargent) ; un jeton d'information calme et un cœur dans le jeu d'icônes.
Décisions : la coche d'une étape atteinte prend la couleur du fond de page, lisible sur l'ambre, le danger et le succès dans les deux thèmes (tenu par le test de contraste).
Découvertes : plusieurs écrans redessinent chez eux des pastilles, des puces et des blocs teintés qui existent dans le design system ; mon avis de relecture ne le vérifiait pas élément par élément. Un contrôle automatique des classes locales qui doublent une brique serait utile.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, tests du design system et des figures du web, rendu Nuit et Jour.
