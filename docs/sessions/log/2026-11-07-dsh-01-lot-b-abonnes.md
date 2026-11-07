# 2026-11-07 — DSH-01 Dashboard de l'agence, lot B (abonnés) — in_progress
Fait : ADR 0081 (acceptée par « ok 0081 » le 07/11, relue par Bilan) ; contrat `subscribers` de `AgencyInsightsSchema` (abonnés actifs en fin de période et la veille, nouveaux, désabonnements, renouvellements, PPV envoyés et achetés, messages, jours lus, heure de lecture) ; domaine `subscribersOf` ; lecture de la photo par `dailyStatsOf` (Bilan, PR #647) dans le `withTenantMember` de chaque créatrice ; bloc « Les abonnés » du Dashboard de l'agence.
Pas fait : captures Nuit/Jour, PC/téléphone (après la fusion de #647).
Décisions : un jour compte seulement si chaque compte vu dans la photo a sa ligne ce jour-là (un jour à moitié lu ressemblerait à une chute) ; un compteur encore en calcul sur un jour laisse la somme de la période à null, jamais un nombre partiel ; la courbe des abonnés actifs ne part pas de zéro et se coupe sur un jour non lu.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests unitaires API et web ✓ ; test d'intégration de la route écrit, joué par la CI.
