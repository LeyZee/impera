# ARC-08 Ordre des virements écartés du journal et relance d'émission par son index
Statut : done
Phase : exploitation
Dépend de : ARC-07 (découvertes des lots d1 et d2)
Branche : claude/project-thread-a8l1w6 (fil « Bilan »)

## Objectif (1 phrase)

Fermer les deux découvertes d'ARC-07 : l'export du journal liste ses virements écartés dans un ordre stable, et la relance d'émission ne parcourt plus tous les `invoice_not_issued` de l'outbox.

## Contexte à lire (fichiers précis)

- `docs/sessions/log/2026-11-03-arc-07d1-invoicing-pay-reads.md` et `docs/sessions/log/2026-11-03-arc-07d2-invoicing-file-reads.md` (« Découvertes »).
- `apps/api/src/modules/accounting/infra/accounting-store.ts` (`factsOf`) et `application/accounting.ts` (`journal`).
- `apps/api/src/modules/invoicing/infra/requeue-store.ts`, `packages/db/src/schema/events.ts`.

## À faire (liste vérifiable)

- [x] `transfersLeftOut` trié par membre puis par quinzaine (`transfersLeftOutInOrder`, règle pure de `accounting/domain/journal.ts`), quel que soit l'ordre de lecture des membres.
- [x] `payroll.requeue_invoice_issues` lit les `invoice_not_issued` par un index partiel (`domain_events_invoice_not_issued_idx`, sur `payload->>'memberId'`, migration 0075), et seulement ceux du prestataire quand il est nommé.

## Critères d'acceptation (tests, commandes, comportements observables)

- Test unitaire de l'ordre ; `payroll-journal` et `payroll-regimes` (relance) inchangés et verts.
- Aucun comportement changé : mêmes relevés relancés, mêmes routes, mêmes codes d'erreur ; `payroll-reference.json` identique.
- `pnpm check` et la CI verts ; drift Drizzle aligné.

## Hors périmètre

- Un filtre par date sur les `invoice_not_issued` : un événement ancien d'une émission toujours bloquée doit rester relancé.
