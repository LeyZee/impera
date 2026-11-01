# 2026-11-01 — EQ-06 : pas de document sur un dossier non vérifié (fil Équipe) — done
Fait : sans migration. Motif `identity_unverified` (« ok dossier » de Charles, 01/11 21h04) : un dossier complet que le propriétaire n'a pas vérifié tel qu'il est (jamais vérifié, ou vérification retirée par un changement d'identité) ne donne ni facture ni avoir ; le propriétaire est alerté une fois (`invoice_not_issued`, Telegram « le dossier prestataire n'est pas encore vérifié »). `issueDecision` et `planInvoicing` lisent `identityVerified` (`contractor_profiles.verified_at`) ; la vérification relance déjà l'émission (lot 5a). Les profils des tests d'intégration sont vérifiés après leur écriture ; le test de la société et celui du dossier montrent le blocage puis la facture après vérification.
Pas fait : lots 5b, 5c, 7, 8.
Décisions : la garde vient après l'identité complète (un dossier incomplet dit d'abord ce qui lui manque, une vérification ne le remplirait pas) ; elle vaut aussi pour un avoir, qui imprime les parties du jour.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests unitaires de la paie et de Telegram ✓ ; tests d'intégration factures, acceptation, départ, réglages, dossier contre Postgres 16 ✓.
