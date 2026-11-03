# 2026-11-03 — CRM-02 Écran de vérification de fiabilité — in-progress (l'écran est fait)
Fait : bloc « Vérification de fiabilité » dans Réglages › Ventes (`apps/web/src/settings/sales-feed/CheckPanel.tsx`, `CheckReport.tsx`, règles dans `check.ts`) sur `POST …/sales-feeds/:plateforme/check` : quinzaines terminées proposées, autres jours bornés comme le serveur, export CSV facultatif décodé UTF-8 ou Windows-1252, verdict, notes, totaux, jours en écart, tous les jours, membres de l'équipe. `call()` lit aussi le refus de la plateforme en 502. 21 tests de plus (règles, écran).
Pas fait : le reste de la fiche appartient à Bilan et Équipe (vrai export, commissions sur `netAmount`).
Décisions : un écart est ambre, pas rouge (rien n'est cassé, la bascule reste fermée) ; le bouton de fichier natif est remplacé par une pilule française posée sur l'`input` ; seul le net compte pour l'écart d'un membre, le nombre de ventes est affiché pour information.
Découvertes : la ligne CRM-02 du tableau des fiches était restée à `todo` alors que la fiche disait `in-progress` ; corrigée.
Candidats à suppression : aucun.
Vérifié : `pnpm check` ; tests web ; captures Nuit et Jour, 1440 et 390 px, sans défilement horizontal.
