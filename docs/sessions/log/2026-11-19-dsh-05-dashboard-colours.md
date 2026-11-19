# 2026-11-19 — DSH-05 Le Dashboard en couleurs — in-progress
Fait : jetons de Design (agence en bleu, tendance verte et ambre, rampe neutre des sortes de vente) ; avenant du 17/11 à l'ADR 0106 ; parts de l'agence et des créatrices par jour dans la réponse du Dashboard (jamais au MCP) ; courbe du chiffre d'affaires selon la tendance ; petites courbes sous Net et les deux parts ; tests unitaires, d'intégration et d'écran.
Pas fait : avis Design et « ok captures » de Charles, OK de Design et de Bilan.
Décisions : relecture Design du 19/11 : pastilles en vert et ambre, ambre de trait propre au Jour, trait de la bulle à la couleur de la courbe, bulle posée au-dessus des traits près du point, rampe dans l’ordre des poids habituels (fixe par sorte), dernière date des barres ancrée à droite au téléphone ; la courbe dit la même chose que le pourcentage, verte aussi quand rien n'est comparable ; chaque jour est arrondi seul, comme son chiffre d'affaires (au centime en euros, à un centime près par jour en dollars).
Découvertes : la tuile « TVA en plus sur les virements » n’a pas de petite courbe et laisse un vide à côté des trois autres (relecture Design, hors lot).
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓ (intégration en CI) ; captures dashboard-couleurs-1 (données inventées).
