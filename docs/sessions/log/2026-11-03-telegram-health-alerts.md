# 2026-11-03 — Plafond IA en rouge et fiche des alertes de connexion (P3-12) — in_progress
Fait : relectures facultatives de #459 reprises (notice d’échec effacée quand le dernier enregistrement réussit, commentaire de `usdRater`, doc de l’export `latestRateOf`). Le plafond IA atteint sonne en `urgent` (toute génération s'arrête jusqu'à minuit), les 80 % restent en `important` ; sous-titres de Réglages › Telegram, ADR 0020 §§ 2-3. Fiche P3-12 : alerte « connexion en panne » sur l'événement `connection_state_changed` que Bilan écrit après CRM-04 b3 (migration 0087), relance unique en `urgent` à 2 h, « Rétabli » dans le fil. Vérifié : tests domaine et web.
Décisions : contrat de Bilan (union discriminée sur `state`, publication à la transition seulement, `unreachable` après plusieurs échecs, 429 n'est pas une panne) ; 2 h avant le rouge, accepté par Charles le 03/11.
Pas fait : le rendu du lot 2, qui attend le contrat.
Découvertes : aucune.
