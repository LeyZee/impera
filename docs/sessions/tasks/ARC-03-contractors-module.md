# ARC-03 Le dossier du prestataire sorti de la paie
Statut : done
Phase : exploitation
Dépend de : ADR 0047 § 1, ADR 0051, ARC-02
Branche : claude/project-thread-fjrft0 (fil « Ranger l'architecture »)

## Objectif (1 phrase)

Premier des quatre modules de la paie (ADR 0047 § 1) : `contractors` (réglages de facturation, dossier, contrat et mandat, régimes, pièces, leurs jobs) sort de `payroll` sans changer un comportement, avec le premier `pure.ts` (ADR 0051).

## Contexte à lire (fichiers précis)

- ADR 0047 § 1, ADR 0051, `docs/architecture/modules.md`.
- `apps/api/src/modules/payroll/README.md` (sections déplacées), `eslint.config.js`, `apps/api/src/__tests__/boundaries.test.ts`.

## À faire (liste vérifiable)

- [x] Référence chiffrée enregistrée avant tout déplacement, à retrouver à l'identique : `payroll-reference.integration.test.ts` (4 relevés, 5 factures dont 4 émises, 1 avoir) et `payroll-error-codes.test.ts` (chaque code d'erreur de la paie et son statut HTTP).
- [x] `apps/api/src/modules/contractors/` : domaine (`contractors`, `regimes`, `documents`, `agency-logo`, `billing` pour le dossier, `retention`, ses erreurs et ses ports), application, infra (stores, routes, buckets, file), `index.ts` et `pure.ts`.
- [x] Deux ports au lieu des imports à l'envers : `ContractorReads` (fuseau de l'agence) et `InvoiceRequeue` (la file de `payroll.requeue_invoice_issues`, que la paie possède et donne par `invoiceRequeue`).
- [x] `wiring/contractors.ts` : le module, les deux buckets des factures, ses trois jobs ; `composition-root.ts` le construit avant la paie.
- [x] ESLint (ADR 0051) : `contractors: []`, `payroll: ['contractors']`, couche `pure`, interdits externes, `no-restricted-syntax` sur `pure.ts`, fixtures et tests de `boundaries.test.ts`.
- [x] README de `contractors` (rôle, dépendances, tables possédées, lectures croisées qui restent), README de `payroll`, `modules.md`, `add-a-module.md`.

## Critères d'acceptation (tests, commandes, comportements observables)

- Les deux fichiers de référence sont identiques avant et après ; aucun test existant n'est modifié autrement que par ses chemins d'import (et `modules.payroll.jobs.*` → `modules.contractors.jobs.*` pour les trois jobs déplacés).
- Routes `/v1/payroll/…`, noms de jobs `payroll.*`, codes d'erreur et statuts HTTP inchangés ; aucune migration.
- `pnpm check`, `pnpm test`, `pnpm test:integration` et la CI verts.

## Hors périmètre

- Les lectures croisées des tables (la paie lit encore celles du dossier, le dossier lit encore `invoices` et `audit_log`) : ports de lecture et test d'architecture, fiche ARC-07 à écrire.
- `invoicing` et `accounting` (PR suivantes d'ADR 0047 § 1), les ports `PayoutGate` et `AfterValidation`.

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- 02/11 : `inputs_hash` couvre des identifiants tirés au hasard ; la référence garde donc les montants, statuts et numéros normalisés, pas les empreintes.
- 02/11 : `reviewOf` et `regimeVatOf` (lecteurs de lignes) passent par `contractors/index.ts` en attendant ARC-07.
- 02/11 : fusionnée (#406, 0d6987e). Le module `accounting` passe avant `invoicing` (ARC-05) : tant que les exports sont dans la paie, sortir `invoicing` ferait un cycle `payroll` → `invoicing` → `payroll`.
