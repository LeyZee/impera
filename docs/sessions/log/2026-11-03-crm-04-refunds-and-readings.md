# 2026-11-03 · CRM-04 · remboursements du jour et lecture du registre (Bilan)

- Fiche : CRM-04 (lectures demandées par Équipe sur #459 : reco 2 de Charles, ADR 0054).
- Fait : `salesFeedTotals.refundsOf` (remboursements par leur propre jour, vendeur de la vente, montants positifs, `olderThanRegister`) et `salesFeedTotals.readingsOf` (`readAt`, `pausedUntil` par plateforme reliée), contrats `SalesRefundsSchema` et `SalesFeedReadingSchema`, `refundsOfDay` pur ; tests unitaires et d'intégration (tenant d'une autre créatrice, créatrice sans compte relié).
- Reste : Telegram branche les deux lectures dans le bilan du soir (#459).
- Découvertes : aucune.
