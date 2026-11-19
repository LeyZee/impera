# 2026-11-16 — CHF-01, ADR 0118 : rapports validés dans le jeu, reprise des gains — in_progress
Fait : ADR 0118 ; le net du jeu compte les shifts au total validé, au net de la chaîne de paie, au jour du shift, sauf quand des ventes sont lues pour ce shift (CHT-04) ; le job reprend un trophée lié à un net, un palier ou un rang que le net corrigé ne justifie plus, sans effacer de ligne, et le renote s'il est regagné (CHT-11) ; vider ou monter les seuils ne reprend rien, et le réglage le dit (EQU-04) ; textes « ne redescend jamais » remplacés sur « Mon rang », le dévoilement et le réglage des seuils ; migration 0223 (`taken_back_at`, `basis_minor`, index unique partiel, droit du rôle de service sur une colonne).
Pas fait : la phrase de « Moi › Trophées » (écran de la Vitrine, texte transmis) ; la mention « Dix PPV » sur ce trophée (même écran) ; le récapitulatif de dévoilement au-delà de deux gains (CHT-09).
Décisions : ADR 0118.
Découvertes : « Mes chiffres » lit toujours les seules ventes lues : un chatteur payé sur rapports y voit zéro ; même règle que l'ADR 0118, à faire dans la PR suivante. Un rapport validé ne se refuse plus (EQ-03) : seule une correction validée fait baisser son total, les tests et l'ADR le disent ainsi.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test (intégration en CI, pas de Docker dans la session).
