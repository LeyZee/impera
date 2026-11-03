# 2026-11-03 — CRM-03 : un remboursement dit au masculin dans « Ventes en attente » — done
Fait : le reliquat laissé par b4c2 dans `apps/web/src/payroll/held-sales.ts`, sans montant ni règle nouvelle :
- `decisionText` accorde la puce avec la ligne : « Compté pour Théo », « Compté », « Écarté » pour un remboursement ;
- `ownLineText` (nouveau) : « C'est un remboursement de ton chatteur : un autre membre en décide. », lu par `HeldSalesPanel` ;
- `heldReasonText` (chatteur non relié) : « le remboursement se déduit seul. Sinon, écarte-le. » ;
- `outcomeWords` passe une ligne de remboursement à `refundWords` : la fenêtre parle du remboursement, et de sa vente qu'une décision emporte avec lui (la décision se prend sur la vente, lot b3). Un remboursement seul (vente d'avant le registre ou d'avant la bascule) ne parle pas de sa vente et dit « tant qu'aucune clôture ne l'a compté » ; après la relecture d'Extension, « et le remboursement s'en déduit » plutôt que « et lui », qui pouvait se lire comme le membre.
Décisions :
- `outcomeLabel` ne change pas : « Compter pour Théo », « Écarter », « Retirer la décision » sont des infinitifs, qui ne s'accordent pas ;
- une ligne de remboursement payée qu'on écarte dit que sa vente ne comptera pour personne non plus, puisque c'est la même décision.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `held-sales.test.ts` (1 nouveau) ; `PeriodPage.test.tsx` (1 nouveau : puce, geste et ligne de son propre chatteur sur un remboursement) ; captures (téléphone 390 et bureau 1440, Nuit et Jour, données inventées) dans `/mnt/project-files/reglages-ventes/crm-03/remboursements/` : `ventes-*` (« Mes ventes lues » refaites après la relecture de b4c2), `valideur-*`, `ecarter-*` ; pnpm check ✓.
