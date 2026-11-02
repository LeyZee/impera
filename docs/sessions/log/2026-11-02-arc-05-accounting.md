# 2026-11-02 — ARC-05 : les exports du comptable sortis de la paie — in_progress
Fait : ARC-03 fusionnée (#406). Module `accounting` créé depuis `payroll` : journal et FEC, DAS2, archive des PDF, leurs routes et leur journal d'audit. `payroll/pure.ts` (`periodWords`, `settlementsDue`, `StoredInvoicePdf`) ; l'archive relit chaque PDF par `checkedPdf` de la paie ; `AccountingReads` pour le fuseau de l'agence. Routes, codes d'erreur inchangés, aucune migration, aucun job.
Décisions : `accounting` avant `invoicing`, sinon cycle tant que les exports restent dans la paie. Les ports de lecture et les tests d'architecture deviennent ARC-07 (ARC-04 est la fiche `checkInternals` de Bilan, #408).
Pas fait : `invoicing` (ARC-06), ports de lecture et tests d'architecture (ARC-07).
Découvertes : rien de nouveau.
