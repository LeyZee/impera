# 2026-11-12 — Playground fiable, PR 1 : la note de désir à l'écran — done
Fait : la note de désir s'affiche au playground sous chaque message du fan (score, mouvement, signaux avec leurs points) et dans « Pourquoi » (jauge, seuils de la persona, verdict) ; « Pourquoi » dit aussi la décision du curseur et pourquoi la règle a refusé une offre. Le cœur rend la lecture du désir même quand elle ne bouge pas (`desireRead`). Le playground mesure enfin la vitesse de réponse du fan sur l'horloge simulée. ADR 0102 et 0103 acceptées (« ok 0102 ok 0103 »).
Pas fait : le reste des recommandations (composeur de prod au playground, banque d'exemples 0102, playground en base 0103 avec la migration 0176, marques « trop haute / trop basse »).
Décisions : ADR 0102 et 0103 acceptées.
Découvertes : avant cette PR, le bonus « réponse rapide » ne comptait jamais au playground alors qu'il compte en prod : la barre y était plus basse qu'en vrai.
Candidats à suppression : aucun.
Vérifié : voir la PR.
