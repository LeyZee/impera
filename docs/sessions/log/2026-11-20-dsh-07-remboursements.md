# 2026-11-20 — Les remboursements un par un — in-progress
Fait : ADR 0092 § 4. Les connecteurs listent les remboursements que les totaux de la période retranchent (`refundListOf`), la supervision les nomme et les convertit (`refundList` du contrat, mêmes droits que « Qui a vendu », jamais au MCP), l'écran les montre en tableau filtrable par créatrice et par chatteur de la vente.
Pas fait : captures, relectures Bilan et Design.
Décisions : aucune ADR touchée. Un remboursement d'une vente hors registre est listé sur son propre jour, délai « vente hors registre », comme le compte à part du Dashboard.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests unitaires des connecteurs, de la supervision, du MCP et de l'écran ; test d'intégration ajouté (Docker absent ici, la CI le joue).
