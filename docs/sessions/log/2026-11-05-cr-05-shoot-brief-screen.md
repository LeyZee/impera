# 2026-11-05 — Agenda de la créatrice : sa fiche de tournage à l'écran (CR-05, après VEI-01 d1) — in-progress

Fait :

- `ShootBrief` (apps/web/src/screens/agenda/) : la fiche en texte brut, retours à la ligne gardés (`white-space: pre-line`), jamais lue comme du Markdown. Pliée (`details`/`summary`) sur une proposition de l'agence, où elle décide avant de tout lire ; ouverte dans sa tâche, d'où elle tourne.
- `SuggestionCard` et `TaskDialog` la montrent quand elle existe ; rien ne change pour une tâche sans fiche.
- Les boutons d'une tâche ouverte (`ag-task-foot`) passent à la ligne sur téléphone : « Retirer de mon agenda » sortait du cadre à 390 px.

Pas fait : lot c2 (iCal), lot c3 (shifts de ses comptes).

Décisions : la fiche n'a pas de bouton d'édition, elle ne l'écrit jamais (colonne hors de son `GRANT UPDATE`, #513).

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `AgendaPage.test.tsx` (fiche pliée sur la proposition de Ma semaine, fiche ouverte dans la tâche avec ses lignes) ; captures Nuit et Jour au téléphone, hors dépôt.
