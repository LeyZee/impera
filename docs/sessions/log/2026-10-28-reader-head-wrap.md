# 2026-10-28 — Suivi, en-tête du lecteur sur téléphone (Extension) — done
Fait :
- À 400 px, la pastille d'état (« Un humain répond ») passait sous le bouton « Rendre la main à l'agent ». La colonne du nom part maintenant de 11rem (`.tr-reader__who`, `flex: 1 1 11rem`) : quand le bouton ne tient plus à côté, il passe à la ligne, sous le nom et la pastille. Rien ne change sur ordinateur.
Pas fait : rien.
Décisions : la largeur de départ couvre la plus longue des pastilles d'état (`STATE_LABELS`), sans toucher aux classes `nv-*`.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ; captures Nuit et Jour, 1 440 et 400 px, sur le serveur de dev (jsdom ne calcule pas de mise en page, d'où l'absence de test unitaire).
