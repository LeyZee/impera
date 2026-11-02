# 2026-11-02 — Facture d'un relevé avec prime de palier ou d'objectif collectif (fil Équipe) — done
Fait : `invoice-store.ts` passait à `invoiceLines` le total des primes du relevé (`bonuses_minor` : palier + objectif collectif + primes manuelles) comme s'il s'agissait des seules primes manuelles. Le contrôle « The bonuses are not those the statement counted » levait donc une erreur pour tout relevé qui avait un palier ou un objectif atteint : pas de facture, donc pas de versement (ADR 0041). Les primes manuelles se lisent désormais comme le total moins le palier et l'objectif, qui ont leur ligne à eux. Nouveau test d'intégration : un relevé avec les trois sortes de primes donne une facture avec une ligne par prime, et un HT égal à commission + primes.
Pas fait : rien.
Décisions : aucune ; aucun montant ne change, la facture porte ce que le relevé comptait déjà.
Découvertes : les tests de factures n'avaient ni palier ni objectif ; signalé par le fil qui écrit le scénario de référence de l'ADR 0047 § 1.
Candidats à suppression : aucun.
Vérifié : test d'intégration rouge avant le correctif (RangeError), vert après ; `payroll-invoices.integration.test.ts` vert (11 tests) ; pnpm check ✓.
