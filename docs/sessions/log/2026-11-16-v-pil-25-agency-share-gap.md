# 2026-11-16 — DSH-03 suite, V-PIL-25 : l'écart de part montré sur la fiche — review
Fait : chaque part lue (`ObservedAgencyShare`) porte `differsFromRate`, calculé par le serveur avec la règle de l'alerte d'écart (ADR 0054 § 2, `agencyShareGaps`), chaque jour avec son pourcentage, `null` sans pourcentage. La fiche passe en ambre : « Écart : Reveal donne 37,5 % du net sur 30 jours, tu as réglé 40 % », et chaque ligne en écart le dit. Dates en « 1er octobre 2026 », quinzaines en « du 1er au 15 novembre », premier jour en « aujourd'hui ».
Pas fait : sélecteur de date maison pour « À partir du » (DayField est partagé : Design) ; le Dashboard agrège toutes les créatrices et ne montre pas d'écart par créatrice.
Décisions : aucune nouvelle ; l'écran ne compare rien lui-même.
Découvertes : la créatrice n'a aucune route pour lire sa propre part (écran Ventes, demande de Design du 16/11) : contrat `CreatorEarningsSchema` proposé, PR suivante.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, tests unitaires scheduling et web ✓, intégration agency-rates et agency-share-check ✓, captures part-agence-ecart-1.
