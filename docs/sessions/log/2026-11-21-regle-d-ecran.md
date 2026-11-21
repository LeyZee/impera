# 2026-11-21 — La règle d'écran en dur dans le design system — done
Fait : la demande de Charles du 21/11 devient une section de la page de design, « La règle d'écran » : l'écran sert le travail, on se repère d'un coup d'œil, tout est aligné, une icône se lit sans son texte, un graphique répond et bouge, la couleur porte du sens. Deux garde-fous dans le code : un `<Donut>` s'allume de lui-même au survol quand l'écran ne tient pas la part allumée (et un doigt éteint la part qu'il a allumée) ; `shell/figures/figures-answer.test.ts` échoue si un écran dessine un graphique avec la géométrie du design system sans rien brancher sur le pointeur, ou si une figure partagée perd son entrée ou son état allumé.
Pas fait : la revue des icônes qui ne se lisent pas seules (un lot de captures à part, rien ne change sans l'accord de Charles).
Décisions : la hiérarchie, l'alignement et les icônes se jugent sur captures par le fil Design ; seul ce qui se lit dans le code a un test.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, tests du web.
