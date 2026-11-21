# 2026-11-19 — CHF-01, recette CHT-09 : une seule cérémonie par arrivée, jauges du jeu — in_progress
Fait : `RewardRevealGate` joue un seul dévoilement pour tout ce qui est dû (le plus haut : rang, médaille de palier, trophée, série ; à égalité le plus récent) et passe les autres à `RewardReveal`, qui les nomme sous la phrase (« Aussi gagné », trois au plus puis « +N autres », phrase dédiée au lecteur d'écran) ; fermer marque tout comme vu ; `GameGauge` remplace les jauges du défi, de « Mon rang » et du palier visé : une fois, de la dernière valeur montrée (mémoire locale par compte, par cible) à celle du jour, en `transform` seul.
Pas fait : le lot 3.
Décisions : aucune nouvelle ; note du 19/11 à l'ADR 0104 (§ 12), validée par Charles avec le lot « jeu-ceremonie-jauges-1 ».
Découvertes : `nv-gauge__fill` anime `width` avec un rebond sur tous les écrans, à revoir par Design selon sa règle d'animation.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test (intégration en CI, pas de Docker dans la session).
