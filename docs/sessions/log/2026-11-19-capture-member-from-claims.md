# 2026-11-19 — Capture de la session Reveal : le membre lu dans le jeton — done
Fait : la « Sync » ne prend plus le membre dans la première route `/users/:id/…` vue (le 19/11, l'onglet lisait `/users/me/context` et la fiche d'un autre membre, et le serveur refusait la session) ; elle le lit dans les claims du jeton, comme le serveur le vérifie, et garde la route en repli en ignorant « me ». Route ajoutée au guide `reveal-api-observed.md`.
Pas fait : la refonte de la carte « Connexion Reveal » du popup (même fil, PR suivante).
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests de la capture (19), pnpm check.
