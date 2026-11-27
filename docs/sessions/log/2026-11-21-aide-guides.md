# 2026-11-21 — Moi › Aide : le guide de chacun dans l'app — done
Fait : brique `nv-guide` du design system (repliée au chevron, une couleur par page, étapes avec « Tu dois voir », encadrés « À savoir », « Jamais », « Si ça coince ») ; page Moi › Aide pour le manager, le chatteur et la modèle, Réglages › Aide pour le propriétaire (l'essentiel et la journée en trois temps, les guides avec un sommaire, les pages d'aide existantes, les questions fréquentes) ; textes dans `apps/web/src/help/guides.ts`, relus par les fils Agent, Équipe, Médias, Bilan, Chiffres, Sur mesure et Extension.
Pas fait : poser chaque guide replié à côté de son écran (suite, écran par écran avec les fils propriétaires) ; les gestes encore en file (retour de fin de shift, « Où te verser », Coffre Impera, Commandes en cours, mode soin) entrent avec leur PR.
Décisions : aucune ADR ; le contenu est une donnée, aucune règle métier dans le texte.
Découvertes : « Lire la fiche du fan » décrit les onglets du copilote de #1010 : cette PR fusionne après elle.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, tests web de src/help, src/shell, src/screens/me, src/screens/settings ✓ ; captures Nuit/Jour, PC et téléphone, des quatre rôles (données inventées).
