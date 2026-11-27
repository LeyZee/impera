# 2026-11-21 — SCB-04 Retrait de l'ancien onglet Scripts à deux vues — done
Fait : demande de Design après la fiche en sept onglets (#950), qui place elle-même `PreparedScriptsView` et `ScriptsToCopyView`. `ScriptsTab.tsx` et `ViewTabs.tsx` n'étaient plus placés par l'application : retirés, avec le style `.se-tabs` qu'eux seuls portaient. Leurs tests passent sur les deux vues seules (`scripts-views.test.tsx`) ; l'aller-retour « À copier » → « Scripts » est celui de la fiche.
Pas fait : rien.
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests web de Créatrices, typecheck web.
