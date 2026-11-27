# Paie et factures

La quinzaine, les taux, les reports, les avoirs, les factures et le versement.

Cette page ne décide rien : elle range. La règle est dans chaque décision liée ; le titre d’une décision est sa règle en une phrase. Quand une décision a été changée en partie par une plus récente, c’est indiqué, et la plus récente gagne sur le point qu’elle change.

## Décisions, de la plus ancienne à la plus récente

- **0032** · [Paie : la quinzaine se clôture pour toute l'équipe à sa première validation](../adr/0032-pay-period-closing.md) — acceptée
  - précisée ou complétée par : [0033](../adr/0033-exchange-rate-source.md), [0035](../adr/0035-pay-entry-locks.md), [0043](../adr/0043-chatter-sale-entries-and-report-check.md)
- **0033** · [Paie : le taux dollar → euro vient de la BCE, lu chaque heure par un job](../adr/0033-exchange-rate-source.md) — acceptée
- **0035** · [Paie : une saisie verrouille sa quinzaine et chacune des suivantes](../adr/0035-pay-entry-locks.md) — acceptée
  - précisée ou complétée par : [0043](../adr/0043-chatter-sale-entries-and-report-check.md)
- **0036** · [Factures : ce qu'une quinzaine doit rendre devient un avoir sur une facture déjà émise](../adr/0036-credit-notes-a-period-owes.md) — acceptée ; en partie changée par [Factures : une contestation fondée se corrige par la paie, jamais par un avoir écrit à la main](../adr/0039-upheld-contest-corrected-by-payroll.md)
- **0037** · [Factures : un PDF/A rendu une fois par PDFKit, gardé dix ans sous verrou de conformité, en deux copies](../adr/0037-invoice-pdf-rendering-and-storage.md) — acceptée
  - précisée ou complétée par : [0152](../adr/0152-hosting-hostinger-vps-and-supabase.md)
- **0038** · [Paie : un petit montant est reporté deux fois au plus, pour que chaque facture soit payée avant son échéance](../adr/0038-bounded-carry-over-before-due-date.md) — acceptée
  - précisée ou complétée par : [0072](../adr/0072-departed-member-final-statement-and-written-off-balance.md)
- **0039** · [Factures : une contestation fondée se corrige par la paie, jamais par un avoir écrit à la main](../adr/0039-upheld-contest-corrected-by-payroll.md) — acceptée ; en partie changée par [Factures : « annuler et refacturer » émet une facture rectificative, sous le régime de la facture annulée](../adr/0040-reissue-as-corrective-invoice.md), [Paie : le relevé final d'un membre parti est celui de la quinzaine de son départ, et son solde négatif s'éteint](../adr/0072-departed-member-final-statement-and-written-off-balance.md)
- **0040** · [Factures : « annuler et refacturer » émet une facture rectificative, sous le régime de la facture annulée](../adr/0040-reissue-as-corrective-invoice.md) — acceptée
- **0041** · [Factures : l'attestation de résidence fiscale conditionne le versement, pas la facture](../adr/0041-tax-residence-gates-the-transfer.md) — acceptée
- **0072** · [Paie : le relevé final d'un membre parti est celui de la quinzaine de son départ, et son solde négatif s'éteint](../adr/0072-departed-member-final-statement-and-written-off-balance.md) — acceptée
- **0084** · [La quinzaine vérifiée peut être la première payée sur les ventes Reveal](../adr/0084-checked-fortnight-paid-on-platform-net.md) — acceptée

Retour au [sommaire des règles](README.md).
