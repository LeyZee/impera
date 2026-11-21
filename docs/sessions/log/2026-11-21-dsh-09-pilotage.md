# 2026-11-21 — DSH-09 Le pilotage de l'agence — in-progress
Fait : audit du Dashboard rendu à Charles, choix « les 4 cartes + corrections ». Route `GET /v1/dashboard/agency/steering` (objectif du jour, trafic vers l'argent, dépendance et payeurs qui ont décroché), trois cartes en tête du Dashboard de l'agence et d'une créatrice, « Des fans t'attendent » en tête, pastilles d'écart sans couleur sur trop peu de ventes, corrections PRO1-02, PRO1-17, DS-03, PRO2-01.
Pas fait : carte « L'IA rapporte-t-elle ? » (attend la PR du fil coût de l'IA), captures.
Décisions : avenant du 21/11/2026 de l'ADR 0092.
Découvertes : sur le Dashboard d'une créatrice, « Ventes » et « Parcours des fans » ne reçoivent aucune donnée (`live.ts` pose `sales: null`) : code mort à retirer dans une tâche à part. « vs » des choix de comparaison gardé (demande de Charles du 16/11), H-09 non repris.
Candidats à suppression : `Sales.tsx` (sauf `PeriodControl`), `AGENT_PATH` de `Funnel.tsx`, le type `Sales` de `model.ts`.
Vérifié : tests unitaires api (supervision) et web (dashboard), typecheck api et web ; intégration écrite, non lancée ici (pas de Docker), à voir en CI.
