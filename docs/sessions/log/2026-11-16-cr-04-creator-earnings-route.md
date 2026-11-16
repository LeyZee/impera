# 2026-11-16 — CR-04 : sa part, lue par la créatrice — review
Fait : `GET /v1/creator-space/earnings` (créatrice seule, `withCreatorAccount`) rend sa part de la quinzaine en cours (jusqu'à aujourd'hui) et de la précédente, par devise sans conversion, puis jour par jour du plus récent au plus ancien dans son fuseau (`creators.timezone`), nette des remboursements, avec le nombre de remboursements et ce qu'ils ont retiré, sur le jour de leur vente (`CreatorEarningsSchema`, `creatorEarnings`). `creatorSalesReads.salesOf` de `connectors` prend un fuseau facultatif, celui de la plateforme par défaut. Amendement de l'ADR 0106 (§ 15 à § 20).
Pas fait : l'écran Ventes (Design), les vues Aujourd'hui, mois et écart au mois précédent de la fiche.
Décisions : Charles (16/11 11h51) : sa part seulement, deux quinzaines comme la paie, nette comme Reveal la compte, détail des remboursements sous un chevron, total par quinzaine puis par jour dans son fuseau, plusieurs devises dans le total. Ses quinzaines sont lues dans son fuseau, comme ses jours.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, tests unitaires creator-earnings et creator-sales ✓, intégration creator-earnings, creator-on-duty, sales-totals, authentication-sweep et origin-sweep ✓.
