# 2026-11-03 — CRM-04 lot c : les ventes lues chez Reveal sur le Dashboard — done
Fait :
- Contrat : `DashboardSchema.revealSales` (période, totaux, détail par vendeur ou `null`, dollars, remboursements plus vieux que le registre). Un montant est signé : un remboursement est négatif.
- `supervision` : `revealSalesPanel` (pur) regroupe les lignes de `salesFeedTotals.totalsOf` par vendeur, en quatre sortes (membre, agent, chatteur non relié, sans chatteur), convertit les dollars une fois par vendeur au taux de la paie, et fait du total la somme des vendeurs. `salesDays` donne les jours de la période dans le fuseau de la créatrice.
- Lecteur `reveal-sales-reader` sous `withTenantMember` : rien tant qu'aucun compte de la créatrice n'est relié au registre (`sales_feed_models`), les noms des membres seulement pour le propriétaire et un manager actif.
- Web : section « Ventes lues chez Reveal » (chiffre d'affaires, net, part de l'agence, part de la créatrice, qui a vendu). « Chatteur non relié » en ambre, avec « à relier dans Réglages › Ventes ».
Pas fait :
- Alerte d'écart entre `modelRevenue` et le pourcentage réglé (question 5) : lot d, le pourcentage n'existe pas encore.
- Alerte quand une vérification CRM-02 ne correspond plus après la bascule (question 6) : lot b.
Décisions :
- La créatrice reçoit `revealSales: null` : elle aura son propre écran au lot d, sans vendeur (ADR 0042 § 2).
- Une lecture de portée « soi » (opérateur hors équipe) ne reçoit rien du panneau, pas même les totaux : en retranchant ses ventes, il déduirait celles des autres (relecture Bilan, ADR 0043 § 7). Un chatteur de l'équipe reste refusé au Dashboard (ADR 0024).
- La plateforme n'est jamais écrite à l'écran : le contrat porte `platforms` (les plateformes de ses comptes reliés au registre) et l'écran les nomme par `platformName` (relecture Extension).
- Aucun montant recalculé : les montants de Reveal tels quels (ADR 0050 § 8).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié :
- Unitaires : `reveal-sales.test.ts` (6), contrat `dashboard.test.ts` (5), `DashboardPage.test.tsx` (40) ; `pnpm test` vert.
- Intégration `dashboard-reveal-sales` (5) et `dashboard` (17) verts.
- `pnpm check` vert. Captures Nuit et Jour, téléphone et bureau, dans le dossier partagé du projet (`reglages-ventes/crm-04/lot-c/`).
