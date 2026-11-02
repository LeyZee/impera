# ARC-05 Les exports du comptable sortis de la paie
Statut : in_progress
Phase : exploitation
Dépend de : ADR 0047 § 1, ADR 0051, ARC-03
Branche : claude/project-thread-fjrft0 (fil « Ranger l'architecture »)

## Objectif (1 phrase)

Deuxième des quatre modules de la paie (ADR 0047 § 1) : `accounting` (journal et FEC, DAS2, archive des PDF) sort de `payroll` sans changer un comportement, avant `invoicing`, pour qu'aucun cycle n'apparaisse.

## Contexte à lire (fichiers précis)

- ADR 0047 § 1, ADR 0051, `docs/architecture/modules.md`.
- `apps/api/src/modules/payroll/README.md` (sections déplacées), `apps/api/src/modules/contractors/` (ARC-03, le même geste).

## À faire (liste vérifiable)

- [x] `apps/api/src/modules/accounting/` : domaine (`accounting`, `archive`, `fec`, `journal`, ses ports et son erreur), application, infra (store, routes, journal d'audit), `index.ts`.
- [x] `payroll/pure.ts` (ADR 0051) : `periodWords`, `settlementsDue` et leurs types, `StoredInvoicePdf`.
- [x] Un port au lieu des imports internes : `AccountingReads` (fuseau de l'agence) ; l'archive relit chaque PDF par `checkedPdf` de `PayrollModule`.
- [x] `wiring/accounting.ts`, construit après la paie ; ESLint : `accounting: ['payroll', 'contractors']`.
- [x] README de `accounting` et de `payroll`, `modules.md`.

## Critères d'acceptation (tests, commandes, comportements observables)

- `payroll-reference.json` et `payroll-error-codes.json` identiques ; aucun test existant modifié autrement que par ses chemins d'import.
- Routes `/v1/payroll/accounting/…`, codes d'erreur et statuts HTTP inchangés ; aucune migration, aucun job.
- `pnpm check`, `pnpm test`, `pnpm test:integration` et la CI verts.

## Hors périmètre

- `invoicing` (ARC-06, à écrire), avec `PayoutGate` et `AfterValidation`.
- Les lectures croisées des tables et les tests d'architecture d'ADR 0047 § 1 : une table, un seul module qui l'écrit et un `schema.<table>` lu seulement par son propriétaire ; un gestionnaire par job (ARC-07, à écrire).

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- 02/11 : `accounting` passe avant `invoicing` : tant que les exports sont dans la paie, sortir `invoicing` ferait un cycle `payroll` → `invoicing` → `payroll`. ADR 0047 donne les dépendances de chaque module, pas l'ordre des PR.
