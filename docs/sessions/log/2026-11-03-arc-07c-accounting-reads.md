# 2026-11-03 — ARC-07 lot c : les exports lisent par les index.ts des propriétaires — done
Fait : `accounting` ne lit plus aucune table de `payroll`, `invoicing` ou `contractors`. Il lit dans la transaction de l'export par `payReadsForAccounting`, `invoiceReadsForAccounting` et `contractorReadsForAccounting`, exportés par l'`index.ts` de chaque propriétaire. Sept lignes de moins dans `OPEN_CROSSINGS` (29 restent, toutes dans `invoicing`). L'espace en trop du README de `contractors` vue par Équipe sur #418 est corrigée.
Décisions : pas de port branché au composition root, puisque `accounting` dépend déjà des trois ; requêtes déplacées telles quelles.
Pas fait : lot d (factures).
Découvertes : rien de nouveau.
