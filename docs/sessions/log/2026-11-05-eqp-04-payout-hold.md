# 2026-11-05 — Recette EQP-04 : un versement bloqué dit pourquoi — done

Fait :

- `CommissionStatement.notIssuedReason` : avec un blocage `documents_not_issued`, la dernière raison qu'`invoice_not_issued` a dite pour ce relevé (mandat, régime, identité, préfixe, agence, avoir). Lue par `PayoutGate.notIssuedReasonsUnscoped` (invoicing) dans une transaction admin : ces événements sont ceux de l'agence, sans créatrice, et n'en sortent que des raisons de relevés déjà lus sous les politiques du lecteur.
- Commissions (chatteur, manager pour lui-même) : plus de « Le versement suit » quand rien ne peut partir. Un encart ambre sous le montant, dans le héros et dans un relevé passé, dit ce qui manque et, quand c'est à lui d'agir, mène à Moi › Dossier (« Ouvrir mon dossier ») ; sinon « Rien à faire de ton côté ».
- Paie › Quinzaine et le relevé : la ligne nomme la pièce (« facture pas encore émise, le membre n'a pas encore accepté son mandat de facturation ») ; le propriétaire a le lien vers le dossier du membre ou vers Réglages › Facturation ; un manager lit la raison, sans lien.
- Paie › Factures : un panneau « N relevés validés sans facture » au-dessus des documents de la quinzaine, avec le nom, le montant à verser, la raison et le lien.

Pas fait : rien sur ce constat.

Décisions :
- la raison est la plus récente dite pour le relevé : une relance ne redit qu'une raison nouvelle (`publishNotIssued`), donc la plus récente est celle en vigueur ;
- `PayoutBlockSchema` reste tel quel : il est aussi dans les événements Telegram déjà écrits ; la raison va sur le relevé, à côté.

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié :
- `pnpm check` ;
- unitaires `payroll/model` (textes du membre et du propriétaire, lieu de règlement), `CommissionsPage`, `PeriodPage`, `InvoicesPage` ;
- intégration `payroll-invoices` : avant l'émission, pas de raison ; `no_mandate` lu par le propriétaire et par le membre ; `identity_incomplete` puis `identity_unverified` ; plus rien une fois la facture émise.
