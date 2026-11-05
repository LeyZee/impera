# 2026-11-03 — Alerte Telegram d'écart de part créatrice (CRM-04 d3, côté Telegram) — done
Fait : `agency_share_mismatch` lu par le scan (créatrice, plateforme, compte, quinzaine ; ni parts, ni écart, ni ventes) et rendu en « Important » aux seuls groupes « pour toutes » (`allCreatorsOnly`), un message par compte et quinzaine quelles que soient les devises (`oncePerThread`, fil `agency_share:<compte>:<quinzaine>`), lien Créatrices › Pourcentage. Migration 0102 (numéro du coordinateur) : le déclencheur prend le type. ADR 0020 § 3, README, fiche CRM-04. Vérifié : tests domaine, infra et intégration (rien dans son groupe à elle, un seul message pour deux devises, aucun montant).
Décisions : groupes « pour toutes » même pour un événement de la créatrice et aucun montant ni pourcentage (accepté par Charles le 03/11, fil Équipe) ; le nombre de ventes n'est pas dit, puisqu'il ne compterait qu'une devise.
Pas fait : rien pour ce lot.
Découvertes : aucune.
