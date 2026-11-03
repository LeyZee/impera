# 2026-11-03 — ARC-07 lot b : les lectures du dossier par des ports — in_progress
Fait : ARC-07 lot a fusionné (#415). `contractors` ne lit plus `invoices` ni `commission_statements` : il déclare `ContractorInvoiceReads` (`hasDocument`, le préfixe figé) et `ContractorPayReads` (`paidOn`, le jour d'un virement encore payé), que `invoicing` et `payroll` implémentent et que `wiring/contractors.ts` branche ; deux lignes de moins dans `OPEN_CROSSINGS` (36).
Décisions : la jointure de l'attestation devient deux lectures dans la même transaction, triées comme avant.
Pas fait : lots c (exports) et d (factures).
Découvertes : rien de nouveau.
