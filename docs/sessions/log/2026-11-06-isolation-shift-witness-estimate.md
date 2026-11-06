# 2026-11-06 — Harnais d'isolation : chatteur en shift, témoin positif, estimation

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : coordinateur, point 3 de la suite de l'audit des tests d'isolation (06/11), fin de #588 (partie 2 ; la partie 1 est #604)

## Fait

- `tenant-isolation.integration.test.ts` :
  - un chatteur de A en shift ouvert (de maintenant moins une heure à maintenant plus trois heures) rejoint les personnes du balayage. Celui de A sans shift ne prouvait pas que l'horloge d'accès (`accessClock`, #593) n'ouvre rien de B ;
  - `GET /v1/payroll/shifts/:shiftId/estimate` reçoit sa vraie requête (`?amountMinor=12300`). Le manager de A y atteint l'estimation d'un shift de B : c'est la portée agence (ADR 0023), comme le rapport et la commission, donc ajouté à `AGENCY_SCOPE` ;
  - nouveau témoin positif : sur les lignes de A, le propriétaire envoie les mêmes requêtes valides (profil et document du dossier prestataire) et reçoit 2xx. Les refus sur B tiennent donc à B, jamais à la requête (remarque facultative d'Équipe sur #604).

## Reste

- La séparation de l'éval du nightly (« nightly vert »).

## Découvertes

- Aucune.
