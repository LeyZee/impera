# ARC-07 Une table lue par son seul propriétaire, un job par tâche
Statut : in_progress (lot a fusionné, #415 ; lot b)
Phase : exploitation
Dépend de : ADR 0047 § 1, ARC-06
Branche : claude/project-thread-fjrft0 (fil « Ranger l'architecture »)

## Objectif (1 phrase)

Dernier pas d'ADR 0047 § 1 : entre `payroll`, `invoicing`, `contractors` et `accounting`, une table n'est lue que par son propriétaire (les autres passent par un port de lecture qui reçoit la transaction en cours), et chaque job a exactement une tâche, deux règles qu'un test d'architecture vérifie.

## Contexte à lire (fichiers précis)

- ADR 0047 § 1 (« Chaque table a un seul module propriétaire », « Les jobs »), `docs/architecture/modules.md`.
- Les sections « Tables possédées » et « Lectures croisées qui restent » des README de `payroll`, `invoicing`, `contractors` et `accounting`.
- `apps/api/src/__tests__/architecture.test.ts`, `apps/api/src/wiring/`.

## Découpage

Une PR par lot, dans cet ordre ; chaque lot retire ses lignes de `OPEN_CROSSINGS`, la liste ne fait que rétrécir.

- **a** : le test d'architecture et la liste exacte des lectures encore ouvertes (38, dans 9 fichiers) ; les deux remarques de README d'Équipe sur ARC-06 ; ARC-06 passée à done.
- **b** : le dossier (`contractors`) : le préfixe figé par une première facture (`invoices`) et l'attestation d'un versement (`commission_statements`), par des ports que déclare `contractors` (il n'importe aucun des trois autres) et que branche le composition root.
- **c** : les exports (`accounting`) : relevés, reports, dossiers, réglages et documents lus par les `index.ts` de leurs propriétaires, dans la transaction de l'export.
- **d** : les factures (`invoicing`) : relevés, lignes, saisies et reports de la paie, dossier, régimes, pièces, contrats et réglages du dossier, lus par les `index.ts` de leurs propriétaires ; `reviewOf` et `regimeVatOf` quittent l'`index.ts` de `contractors` s'ils ne servent plus.

## À faire (liste vérifiable)

- [x] a. `architecture.test.ts` : chaque table de `schema/payroll.ts` et `schema/invoices.ts` a un seul propriétaire, celui dont le README la nomme dans « Tables possédées » ; le test voit chaque table qu'un propriétaire utilise dans son code (il ne lit pas à l'aveugle) ; les lectures d'une table d'un autre module de la paie sont exactement `OPEN_CROSSINGS` ; chaque job de `JOB_NAMES`, sauf `JOBS_WITHOUT_TASK`, a sa tâche écrite une seule fois, dans un seul fichier de `wiring/` ; un job de la paie n'est mis en file (`task => '…'`) que par le module qui enregistre sa tâche, et chaque mise en file des quatre modules nomme son job en clair (sinon le test échoue au lieu de passer sans rien lire, relecture de Bilan).
- [x] a. README d'`invoicing` : en-tête des règles pures sans `domain/accounting.ts`, première puce renvoyée au dossier, migration 0045 des PDF ; renvoi à `OPEN_CROSSINGS` dans les trois README ; `modules.md`.
- [x] b. Lectures de `contractors` fermées : `ContractorInvoiceReads.hasDocument` (`invoiceReadsForContractors` d'`invoicing`) et `ContractorPayReads.paidOn` (`payReadsForContractors` de `payroll`), branchés par `wiring/contractors.ts`.
- [x] c. Lectures d'`accounting` fermées : `payReadsForAccounting`, `invoiceReadsForAccounting` et `contractorReadsForAccounting`, lus par l'`index.ts` de chaque propriétaire dans la transaction de l'export.
- [ ] d. Lectures d'`invoicing` fermées ; `OPEN_CROSSINGS` vide, puis retiré.

## Critères d'acceptation (tests, commandes, comportements observables)

- `payroll-reference.json` et `payroll-error-codes.json` identiques à chaque lot.
- Routes, noms de jobs, codes d'erreur, statuts HTTP et requêtes SQL envoyées inchangés en substance (une requête qui joignait deux propriétaires peut devenir deux lectures dans la même transaction, sous les mêmes verrous) ; aucune migration.
- Tests existants modifiés seulement par leurs chemins d'import.
- `pnpm check`, `pnpm test`, `pnpm test:integration` et la CI verts.

## Hors périmètre

- Les lectures de tables d'autres modules qui existaient avant le découpage (`team_members`, `platform_accounts`, `audit_log`, `domain_events`) : ADR 0047 § 1 les laisse telles quelles.
- Les fonctions SQL qui lisent plusieurs propriétaires (`member_documents_open`) : appelées par leur propriétaire derrière un port, comme `documentsOpen`.
- Les frontières à l'intérieur d'un module (ARC-04).

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- 02/11, lot a : le test lit les sources (Drizzle par `schema`, SQL après `from`, `join`, `into`, `update` ou `table`, commentaires retirés) et les propriétaires dans les README, pour que la doc et le test ne puissent pas diverger. Vérifié à la main qu'il échoue sur une lecture nouvelle, une tâche enregistrée deux fois et un job mis en file par un autre module.
- 02/11, lot a : le README d'`invoicing` cite encore `stateAfterCreditNote`, qui n'existe plus dans le code (hérité d'avant ARC-03) : à reprendre avec le lot d.
- 02/11, lot a : `crontab.ts` met aussi des jobs en file, hors des modules donc hors du test ; aujourd'hui seulement des balayages (relecture de Bilan).
- 03/11, lot b : l'attestation d'un versement lisait relevé et pièce dans une seule jointure ; elle lit maintenant le journal et la pièce, puis le jour de chaque virement encore payé par `paidOn`, dans la même transaction, et trie comme avant (jour du virement, puis id dans l'ordre des `uuid` de Postgres). Le préfixe figé garde sa requête, déplacée chez son propriétaire.
- 03/11, lot c : `accounting` dépend déjà des trois autres, donc il importe leurs lecteurs directement, sans port branché par le composition root. Les requêtes sont déplacées telles quelles. Les deux qui changent de forme : l'union des membres d'une période (documents puis virements, sans doublon, dans le même ordre d'arrivée, que l'export ne lit pas) et le nom figé par un document, lu par Zod au lieu de `contractor ->> 'legalName'` (`null` quand la copie n'en a pas, comme avant). Le journal lit les dossiers avec le pays de la fiche, comme la DAS2 : le propriétaire voit chaque membre, donc la jointure ne retire personne.
