# 2026-11-11 — OPS-06 Grok 4.7 réfléchit moins longtemps que ses délais — in_progress
Fait : `reasoningEffort` par rôle, envoyé à xAI seulement ; défauts `low` (cerveau, voix, bascule de la vision) et `medium` (juge) ; test de la passerelle ; doc des fournisseurs.
Pas fait : la mesure sur le PC (évaluations), avant de passer la PR en « prête ».
Décisions : aucune ADR (réglage de l'ADR 0009, sourcé sur docs.x.ai le 11/11).
Découvertes : le 11/11 sur le PC, Grok 4.7 au réglage par défaut a mis environ 56 s pour le cerveau (délai 30 s), 24 s pour la voix et 58 s pour le juge (délai 60 s), avec environ 3 400 jetons de réflexion par appel.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓.
