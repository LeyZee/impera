# 2026-11-16 — ADR 0112 Scripts à branches — done
Fait : ADR 0112 acceptée par Charles (« ok 0112 », 16/11, 0 h 37) et versée ; ligne de l'index des ADR ; glossaire : « Branche » (`script_branch`), « Condition de branche » (`branch_condition`) et l'état `no_branch` du déroulé.
Pas fait : aucun code. Import des branches et envoi par `stepRef` (Bilan, Médias), moteur (Agent), `script_writer` (Médias), éditeur (Design), playground viendront en PR séparées, migration au numéro donné par le coordinateur.
Décisions : ADR 0112 (modèle de Reveal : étapes et branches ; condition structurée, puis texte lu par le cerveau, puis défaut ; textes autour du bundle adaptés par la voix ; 3 messages du fan avant une étape payante ; dépense passée seulement vers une branche plus chère).
Découvertes : `scriptSequences.list` (wire.ts) est lu en strict sans champ de condition et `scriptsOf` (mapping.ts) aplatit une séquence par `stepIndex` : deux branches d'une étape deviendraient deux étapes à la suite. À corriger avec une capture d'une séquence à branches avant la première vente réelle.
Candidats à suppression : aucun.
Vérifié : pnpm check (voir PR) ; docs seulement, pas de test touché.
