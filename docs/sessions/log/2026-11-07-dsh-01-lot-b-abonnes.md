# 2026-11-07 — DSH-01 Dashboard de l'agence, lot B (abonnés) — done
Fait : ADR 0081 (acceptée par « ok 0081 » le 07/11, relue par Bilan) ; contrat `subscribers` de `AgencyInsightsSchema` (abonnés actifs en fin de période et la veille, nouveaux, désabonnements, renouvellements, PPV envoyés et achetés, messages, jours lus, heure de lecture) ; domaine `subscribersOf` ; lecture de la photo par `dailyStatsOf` (Bilan, PR #647) dans le `withTenantMember` de chaque créatrice ; bloc « Les abonnés » du Dashboard de l'agence.
Captures : v1 puis v2 après la relecture d'Extension (jours non lus visibles, infobulle au-dessus de la courbe, achat des PPV comparé en points, échelle à la bonne hauteur), validées par Charles le 07/11 (« ok captures dashboard-abonnes v2 »).
Pas fait : rien sur ce lot. L'infobulle opaque pour tout le CRM revient à Extension.
Décisions : un jour compte seulement si chaque compte vu dans la photo a sa ligne ce jour-là (un jour à moitié lu ressemblerait à une chute) ; un compteur encore en calcul sur un jour laisse la somme de la période à null, jamais un nombre partiel ; pas de comparaison tant que la période d'avant n'est pas lue en entier (sinon +700 % sur 3 mois au démarrage) ; la courbe des abonnés actifs ne part pas de zéro et se coupe sur un jour non lu.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests unitaires API et web ✓ ; tests d'intégration de la route et de la photo ✓ en local (Postgres 16) ; pre-push (check + tests) ✓.
