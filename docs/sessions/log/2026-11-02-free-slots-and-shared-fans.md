# 2026-11-02 — créneaux libres, plusieurs chatteurs sur un compte, fans confiés (ADR 0049, proposée)
Fait : à partir du prototype du calendrier validé à 17h47, demandes de Charles (17h48 créneaux réglables, 17h52 créatrice sans notification, 18h01 créneau réglable un à un, 18h07 deux chatteurs ou l'IA et un chatteur, 18h13 signal de rush) portées dans le prototype (réglages du planning, places, renfort, fans partagés) puis dans l'ADR 0049 ; carte de 18h09 : « Fans partagés entre les deux ». Glossaire : Place, Renfort, Fan confié ; Créneau et En poste corrigés.
Pas fait : aucun code ; les fiches CR-12, CR-13, EQ-08 et EQ-12 seront précisées après l'acceptation de l'ADR 0049.
Décisions : créneaux par réglage daté, jamais rétroactif ; places 1 à 2 par compte et créneau, trois chatteurs au plus en même temps ; vente au chatteur à qui le fan est confié ; la créatrice voit sans être prévenue.
Découvertes : la contrainte `shifts_account_overlap_excl` (migration 0021) interdit aujourd'hui deux membres sur un compte au même moment ; les modèles de shift ont leurs propres heures, indépendantes des créneaux.
Candidats à suppression : aucun.
Vérifié : `pnpm check`.
