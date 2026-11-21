# 2026-11-21 — La règle d'écran en dur dans le design system — done
Fait : la demande de Charles du 21/11 devient une section de la page de design, « La règle d'écran » : l'écran sert le travail, on se repère d'un coup d'œil, tout est aligné, une icône se lit sans son texte, un graphique répond et bouge, la couleur porte du sens. Deux garde-fous dans le code : un `<Donut>` s'allume de lui-même au survol quand l'écran ne tient pas la part allumée (et un doigt éteint la part qu'il a allumée) ; `shell/figures/figures-answer.test.ts` échoue si un écran dessine un graphique avec la géométrie du design system sans rien brancher sur le pointeur, ou si une figure partagée perd son entrée ou son état allumé.
Icônes (accord de Charles sur le lot icones-2) : cinq icônes qui ne se lisaient pas seules sont redessinées (Entraîner, Aujourd'hui, Équipe, « Toutes », l'essai réel d'un service) ; le geste de chaque icône du menu se rejoue à chaque clic, et cinq gestes gagnent une seconde partie qui bouge.
Pas fait : les icônes de l'extension ; les emojis qui servent encore d'icônes sur les cartes de contenu de la modèle.
Décisions : la hiérarchie, l'alignement et les icônes se jugent sur captures par le fil Design ; seul ce qui se lit dans le code a un test.
Découvertes : des emojis servent d'icônes dans Contenu et sur Aujourd'hui de la modèle (« À envoyer », « Commence par ») ; la pastille du palier Bronze (« I ») ne se lit pas seule.
Candidats à suppression : aucun.
Vérifié : `pnpm check`, tests du web.
