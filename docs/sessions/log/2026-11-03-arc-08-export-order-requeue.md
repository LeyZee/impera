# 2026-11-03 — ARC-08 : ordre des virements écartés et relance d'émission par son index — done
Fait :
- L'export du journal rend `transfersLeftOut` par membre puis par quinzaine (`transfersLeftOutInOrder`, règle pure d'`accounting`), au lieu de l'ordre de lecture des membres, qui n'était pas garanti.
- `payroll.requeue_invoice_issues` lit les `invoice_not_issued` par un index partiel (`domain_events_invoice_not_issued_idx`, migration 0075), et seulement ceux du prestataire quand la relance en nomme un. La paie garde toujours, parmi ces relevés, ceux qui sont validés ou payés.
Pas fait : rien.
Décisions : un index partiel plutôt qu'un filtre par date, parce qu'une émission bloquée depuis longtemps doit rester relancée ; même forme que les deux index partiels déjà posés sur `domain_events`.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : test unitaire de l'ordre (`accounting/domain/__tests__/journal.test.ts`) ; `payroll-journal`, `payroll-regimes` et `payroll-reference` en intégration ; drift Drizzle aligné.
