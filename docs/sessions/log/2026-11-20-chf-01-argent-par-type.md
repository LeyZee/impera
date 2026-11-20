# 2026-11-20 — CHF-01, lot 3 : « D'où vient mon argent » par type de vente — in_progress
Fait : la paie lit le type de vente sur la ligne du registre (`SaleLineRead.saleType`) et le garde sur la vente du relevé (`StatementSale.saleType`, facultatif, hors `inputsHash`) ; `myFigures` rend `kinds` (net et nombre de ventes par type sur la quinzaine en cours, ventes sans type comptées à part) ; carte « D'où vient mon argent » dans la colonne de Commissions, dans les parts et les couleurs de l'anneau du Dashboard (`kindSlices`), survol, clavier et toucher.
Pas fait : « Mes PPV » (§ 7), qui attend la lecture des PPV du fil Équipe.
Décisions : aucune nouvelle ; note du 20/11 à l'ADR 0104 (§ 6).
Découvertes : l'anneau du Dashboard (`Ring` dans `AgencyInsights.tsx`) n'est pas exporté ; la carte en reprend le geste dans `MyFigures.tsx`. Un composant commun serait à extraire par Design.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test (intégration en CI, pas de Docker dans la session).
