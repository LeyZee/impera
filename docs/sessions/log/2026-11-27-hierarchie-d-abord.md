# 2026-11-27 — La hiérarchie des informations, premier critère de l'accord Design — done

Fait : la règle demandée par Charles le 27/11 est inscrite dans `docs/design/README.md`, sous « La règle d'écran » : la hiérarchie se juge avant les briques, sur un écran nouveau comme sur un écran existant qu'un lot touche, par quatre questions (qui lit, que lit l'œil en premier, puis en deuxième et troisième, qu'est-ce qui peut se taire). L'accord posté sur une PR dit désormais ce que l'œil lit en premier sur chaque écran du lot.
Pas fait : le ménage du design system lui-même, proposé à Charles et à faire après l'ouverture pour ne gêner aucune fusion en cours.
Décisions : une sous-section datée plutôt qu'une réécriture de « Hiérarchie » et de « La règle d'écran », qui disent déjà les trois niveaux ; ce qui manquait était l'ordre des critères et la façon de juger.
Découvertes : le ménage à proposer tient en cinq chantiers. Les classes locales qui refont une brique (tuile, option, note, pastille) et qu'aucun test ne repère ; les émojis utilisés comme icônes dans l'Agenda et le dépôt de contenu ; la tuile à courbe et la barre empilée, qui n'ont pas de composant partagé ; les préfixes de classes par écran, sans registre, dont deux se sont croisés le 26/11 ; `docs/design/README.md` lui-même, où trois sections datées redisent la hiérarchie.
Candidats à suppression : aucun.
Vérifié : `pnpm check`.
