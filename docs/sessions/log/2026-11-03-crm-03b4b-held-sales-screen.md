# 2026-11-03 — CRM-03 lot b4b : l'écran du valideur, « Ventes en attente » — in-progress
Fait : Paie › Quinzaine montre au propriétaire et à un manager actif les ventes que la quinzaine garde en attente et celles qu'une décision règle (ADR 0050 §§ 3, 5, 7), et laisse les trancher :
- `payroll/api.ts` : `useHeldSales` (`GET /v1/payroll/periods/:period/held-sales`, relu chaque minute) et `decideSale` (`POST /v1/payroll/sale-decisions`) ;
- `payroll/held-sales.ts` : les mots sans React. Quand et quoi (« Vente du … », « Remboursement du … de la vente du … », « vente d'avant le registre »), le net signé, pourquoi la vente attend (chatteur non relié, hors poste, statut inconnu, remboursement d'avant le registre ou d'avant le passage au net), la décision en vigueur (« Comptée pour … », « Écartée »), le nom de chaque geste et ce qu'il fait avant l'envoi ;
- `screens/pay/HeldSalesPanel.tsx` : un panneau sous les relevés, absent tant qu'aucune vente n'attend ni n'est décidée. Une carte par vente : créatrice et compte, quand, chatteur, net, état, raison, puis les gestes que le serveur ouvre (`outcomes`). Un geste ouvre une fenêtre qui le relit, avec une note facultative ; l'identifiant est tiré une fois, si bien que renvoyer après une réponse perdue n'écrit rien deux fois. Un refus se dit dans la fenêtre, et la liste est relue quand il dit qu'elle a bougé. Sur une vente de son propre chatteur, aucun geste : « un autre membre en décide » ;
- sur téléphone, la carte tient en une colonne (net et état sur une ligne) ;
- `countedSalesText` lie le nombre à son nom par une espace insécable (« 1 remboursement » ne se coupe plus), remarque facultative d'Extension sur #441.
Pas fait : le signalement par le chatteur (b4c, migration 0079) ; une ligne payée qu'on voudrait écarter n'apparaît pas ici tant que personne ne la signale, le serveur ne la liste pas (b4c l'y fera venir).
Décisions :
- pas de délai d'annulation de cinq secondes comme pour une validation : une décision se reprend par « Retirer la décision » tant qu'aucune clôture n'a compté la vente ;
- la raison reste lisible sur une vente décidée : on voit pourquoi elle attendait ;
- « En attente » en ambre (avertissement), une décision en puce neutre.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `held-sales.test.ts` (5 nouveaux : quand, raisons pour le propriétaire et un manager, décisions et gestes, confirmations, comptes du panneau) ; `PeriodPage.test.tsx` (5 nouveaux : rien sans vente, liste et gestes, compter avec une note puis relire, refus et même identifiant renvoyé, vente de son propre chatteur) ; `model.test.ts` (espace insécable) ; captures dans `/mnt/project-files/reglages-ventes/crm-03/b4b/` ; pnpm check ✓.
