# 2026-11-06 — ADR 0072 proposée : le relevé final d'un membre parti (questions de paie 12 et 15)

Fait :
- `docs/adr/0072-departed-member-final-statement-and-written-off-balance.md`, statut `proposed`, et sa ligne dans l'index.
- Elle écrit les réponses de Charles du 06/11 (« Je suis d'accord avec tout ») :
  - question 15 : le relevé final est celui de la quinzaine du départ, sans relevé vide après ;
  - question 12 : le total négatif d'un relevé final est ramené à zéro (« Solde abandonné »), et un ajustement qui rendrait négatif le total d'un membre parti est refusé.
- Relecture de Bilan (#600) intégrée le jour même :
  - § 3 : le relevé final se valide au cycle normal même si un document attend encore, et la correction va sur la quinzaine suivante, plutôt que d'attendre la contestation ;
  - § 4 : CHECK sur `written_off_minor` (`<= 0`, nul hors relevé final), affiché en positif ;
  - § 5 : le refus de l'ajustement sous le verrou (membre, quinzaine), contre le brouillon recalculé dans la transaction ;
  - § 6 : relevés déjà validés gardés, brouillon de quinzaine de clôture recalculé à la bascule.
- Acceptée par Charles le 06/11 à 12 h 58 (« ok 0072 »).

Pas fait : le code, dans une PR à part, avec une migration attribuée à l'arrivée sur `main`.

Décisions :
- Une ADR et pas une note de fiche : les deux règles changent des montants et amendent l'ADR 0039 § 6.
- Les avoirs de l'ADR 0036 restent émis : l'abandon dit seulement ce que l'agence ne réclame pas.

Découvertes :
- La forme comptable de l'abandon de créance envers un prestataire parti est à poser au comptable avant la mise en service (EQ-17).

Candidats à suppression : aucun.

Vérifié : `pnpm check`.
