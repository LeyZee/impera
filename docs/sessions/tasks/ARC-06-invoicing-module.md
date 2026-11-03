# ARC-06 Les factures et avoirs sortis de la paie
Statut : done (#414, fusionnée le 02/11/2026)
Phase : exploitation
Dépend de : ADR 0047 § 1, ADR 0051, ARC-05
Branche : claude/project-thread-fjrft0 (fil « Ranger l'architecture »)

## Objectif (1 phrase)

Troisième des quatre modules de la paie (ADR 0047 § 1) : `invoicing` (émission, PDF et copies, acceptation et contestation, rapprochement, liste et échéances) sort de `payroll` sans changer un comportement, et la paie ne lui parle plus que par des ports branchés à l'assemblage.

## Contexte à lire (fichiers précis)

- ADR 0047 § 1 (liens à rebours, `PayoutGate`, `AfterValidation`, test concurrent), ADR 0051, `docs/architecture/modules.md`.
- `apps/api/src/modules/payroll/README.md`, `apps/api/src/modules/accounting/` (ARC-05, le même geste).

## À faire (liste vérifiable)

- [x] `apps/api/src/modules/invoicing/` : domaine (`invoices`, `invoicing`, `invoice-pdf`, `invoice-acceptance`, `contest-correction`, `billing`, `settlements`, `payouts`, ses ports et ses erreurs), application, infra (magasins, file, rendu PDF et polices, routes), `pure.ts`, `index.ts`.
- [x] `PayoutGate` et `AfterValidation` déclarés par la paie (`payroll/infra/ports.ts`), branchés par `wiring/payroll.ts` sur `payoutGate` et `invoicesAfterValidation` d'`invoicing` et `enqueuePayoutCertificateLock` de `contractors` ; `documentsOpen` remplace la lecture directe de `member_documents_open`.
- [x] `correctContest` : la paie écrit les ajustements d'une contestation fondée dans la transaction d'`invoicing` ; seule la paie écrit `pay_adjustments`.
- [x] `invoiceRequeue` donné au dossier par `invoicing` ; `checkedPdf` et `pure.ts` lus par `accounting`.
- [x] `wiring/invoicing.ts` (neuf jobs, un gestionnaire chacun), construit après la paie ; ESLint : `invoicing: ['payroll', 'contractors']`, `accounting: ['payroll', 'invoicing', 'contractors']` ; Dockerfile : chemin des polices.
- [x] Test d'intégration du cas concurrent : un avoir émis pendant un paiement.
- [x] README d'`invoicing`, de `payroll`, d'`accounting` et de `contractors`, `modules.md`.

## Critères d'acceptation (tests, commandes, comportements observables)

- `payroll-reference.json` et `payroll-error-codes.json` identiques.
- Routes `/v1/payroll/invoices/…`, noms de jobs, codes d'erreur et statuts HTTP inchangés ; aucune migration.
- Tests existants modifiés seulement par leurs chemins d'import et le chemin d'accès aux jobs (`modules.invoicing.jobs…` au lieu de `modules.payroll.jobs…`) ; le test de clôture « aveugle » construit la paie avec ses deux ports au lieu des PDF.
- `pnpm check`, `pnpm test`, `pnpm test:integration` et la CI verts.

## Hors périmètre

- Les lectures croisées des tables et les tests d'architecture d'ADR 0047 § 1 : une table, un seul module qui l'écrit et un `schema.<table>` lu seulement par son propriétaire ; un gestionnaire par job (ARC-07).
- Le renommage des ports `Payroll*` (`PayrollInvoiceStore`, …) restés tels quels pour garder le diff lisible.

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- 02/11 : `domain/billing.ts` ne portait plus que `issueDecision` depuis ARC-03 : il passe entier à `invoicing`.
- 02/11 : `payouts.ts` (la décision d'un versement) va à `invoicing`, qui la rend à la paie par `PayoutGate` ; `PayoutHold`, le motif d'un refus, reste à la paie (`PayoutBlocked`) et se prête par `payroll/pure.ts`.
- 02/11 : fusionnée (#414, 6e07b0a) après les relectures de Bilan et d'Équipe ; les deux remarques de README d'Équipe (en-tête « Les factures, règles pures » et migration 0045 des PDF) sont reprises par ARC-07 lot a.
