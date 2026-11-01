# 2026-10-28 — EQ-06 : les règles pures des factures (lot 1 sur 8) — in-progress
Fait :
- La fiche est découpée en huit lots, chacun sa PR (notes de session de la fiche) ; le lot 1, sans migration, est écrit.
- `domain/billing.ts` : le régime d'un prestataire à une date (`regimeOn`), un changement jamais en arrière (`assertRegimeChange`, `billing_regime_backdated_unprocessable`), la fin et l'état d'une pièce (`documentValidUntil`, `documentState`), et la garde d'émission (`issueDecision`) avec ses motifs (`no_mandate`, `no_regime`, `regime_not_validated`, `identity_incomplete`, `nothing_to_invoice`) et ses avertissements (`document_missing`, `document_expired`, `mandate_outdated`).
- `domain/invoices.ts` : les lignes d'une facture depuis un relevé validé et ses saisies (`invoiceLines`), libellées en français, qui tombent au centime sur le total du relevé moins les reports entrants ; les totaux par traitement de TVA (`invoiceTotals`) ; le numéro (`invoiceNumber`, `isInvoicePrefix`) ; l'échéance (`invoiceDueOn`) ; la mention et les lignes d'un avoir (`creditNoteMention`, `creditNoteLines`, `credit_note_amount_unprocessable`).
- Ce qu'une quinzaine doit rendre (ADR 0036, proposée, après la relecture de Bilan) : chaque régularisation en faveur de l'agence, et ce que les lignes laissent sous zéro (`creditsDue`), chacun un avoir entier sur la facture de la quinzaine corrigée ou la dernière facture antérieure qui a assez de reste (`planCreditNotes`), sinon une alerte au propriétaire ; les lignes d'avoir correspondantes (« Régularisation », « Solde négatif »).
- `domain/invoice-acceptance.ts` : le délai de contestation et les étapes de l'acceptation (`nextAcceptance`, `invoice_acceptance_conflict`) ; un avoir de l'agence ne change pas l'état de la facture qu'il cite (`stateAfterCreditNote`).
- `domain/accounting.ts` : le journal des achats (`purchaseJournal`) et les bénéficiaires de la DAS2 (`das2Beneficiaries`).
- Le glossaire gagne « Pièce du prestataire », « Acceptation d'une facture », « Journal des achats » et « DAS2 » ; « Malus » et « Ajustement » disent leur ligne de facture ou leur avoir, « Avoir » son acceptation, et « Solde négatif » entre. Le README du module suit.

Pas fait : les lots 2 à 8 (base et contrats par Bilan, émission, PDF et ADR 0037, dossier et mandat, acceptation, export, écrans). Le lot 1 entre après les écrans d'EQ-05 (#281), dans la série que Charles a acceptée le 28/10 (« oui ;) », 15 h 27).

Décisions (défauts à faire valider par Charles et le comptable, détaillés dans la fiche) :
- Une identité à laquelle manque une mention (nom, adresse, pays, identifiant fiscal quand le régime l'imprime) bloque l'émission ; les pièces et le mandat dépassé restent des avertissements.
- Chaque malus est une ligne au montant demandé, et une ligne « Plafond des réfactions » rend ce que le plafond a retenu ; un malus en pourcentage prend sa part de l'arrondi unique du moteur.
- Un report entrant n'est jamais refacturé ; un total nul ou négatif n'émet rien.
- Échéance à quinze jours de l'émission (réglage) ; le lot 3 donne à la facture d'un montant reporté l'échéance du relevé qui le versera.
- Numéro `PRÉFIXE-AAAA-NNNN`, séquence remise à 1 chaque année.
- ADR 0036, acceptée par Charles le 31/10 (« ok 0036 ») : une régularisation en faveur de l'agence et une quinzaine sous zéro deviennent des avoirs sur des factures déjà émises, jamais une ligne de déduction sur la facture suivante (l'ADR 0023 garde chaque montant facturé dans sa période). Un avoir n'est jamais coupé ; sans facture qui le reçoive entier, alerte et rien d'émis. Question notée pour le comptable.

Découvertes :
- L'ajustement ne garde pas la quinzaine du relevé qu'il corrige : le lot 2 doit l'ajouter, sinon son avoir n'a pas de facture où aller (déjà vu par EQ-05).
- Le régime « France, prestataire redevable de la TVA » fait payer la TVA en plus de la commission, et le moteur de paie ne la connaît pas : question pour Charles et le comptable avant le lot 3.
- L'index des fiches (`docs/sessions/tasks/README.md`) et les cases des fiches EQ-01 à EQ-04 sont en retard sur le code : EQ-01 à EQ-04 y sont « todo » et la plupart de leurs cases sont vides alors que leurs lots sont dans main. Une passe à part sur ces fiches, sans code, les remettrait d'accord.

Candidats à suppression : aucun.

Vérifié :
- `pnpm check` ✓ (typecheck, lint, prettier, knip, check-repo, drift).
- Tests unitaires du domaine de la paie ✓ (12 fichiers, 122 tests, dont 4 nouveaux fichiers : régimes et pièces, lignes et totaux, avoirs et avoirs dus, acceptation, journal et DAS2) ; 7 mutations des avoirs dus et de l’acceptation, chacune fait tomber un test.
