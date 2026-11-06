# 2026-11-06 — ADR 0072 proposée : le relevé final d'un membre parti (questions de paie 12 et 15)

Fait :
- `docs/adr/0072-departed-member-final-statement-and-written-off-balance.md`, statut `proposed`, et sa ligne dans l'index.
- Elle écrit les réponses de Charles du 06/11 (« Je suis d'accord avec tout ») :
  - question 15 : le relevé final est celui de la quinzaine du départ, sans relevé vide après ;
  - question 12 : le total négatif d'un relevé final est ramené à zéro (« Solde abandonné »), et un ajustement qui rendrait négatif le total d'un membre parti est refusé.

Pas fait : le code. Il attend « ok 0072 » et une migration attribuée à l'arrivée sur `main`.

Décisions :
- Une ADR et pas une note de fiche : les deux règles changent des montants et amendent l'ADR 0039 § 6.
- Les avoirs de l'ADR 0036 restent émis : l'abandon dit seulement ce que l'agence ne réclame pas.

Découvertes :
- La forme comptable de l'abandon de créance envers un prestataire parti est à poser au comptable avant la mise en service (EQ-17).

Candidats à suppression : aucun.

Vérifié : `pnpm check`.
