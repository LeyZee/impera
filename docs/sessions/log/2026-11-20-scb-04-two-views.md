# 2026-11-20 — SCB-04 Les deux vues de l'onglet Scripts, chacune seule — done
Fait : demande de Design, pour la fiche en sept onglets. L'onglet Scripts se découpe en deux vues autonomes, sans le sélecteur de vue : `PreparedScriptsView` (la liste, « Nouveau script » et l'éditeur ; `opening` ouvre un script d'emblée, `onCopy` quand l'éditeur envoie à la copie) et `ScriptsToCopyView` (ce qui est prêt à copier, puis `sent` ; `onOpen` rend un script à ouvrir). `ScriptsTab` les compose derrière son sélecteur, comme avant. Le coffre lu par les deux passe par `useEditorMedia`. Seul changement visible : « Ses scripts » et « Nouveau script » sur la même ligne.
Pas fait : rien.
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests de l'onglet Scripts (dont chaque vue seule et l'aller-retour depuis « À copier »), typecheck web ; captures Nuit/Jour, PC/téléphone dans recette/2026-11-20/scripts-a-branches-decoupage-1/.
