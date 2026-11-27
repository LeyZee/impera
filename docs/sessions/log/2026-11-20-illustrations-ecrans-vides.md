# 2026-11-20 — Illustrations des écrans vides — done
Fait : treize dessins pour les écrans vides du CRM, dans la main du coffre ouvert (trait à l'encre du thème, couleurs mêlées du thème, lumière derrière, éclats, léger flottement qui s'arrête avec « Réduire les animations ») : conversation, planning, script, facture, lien, fans, équipe, dossier, boussole, cible, appareil photo, cloche, couronne (`apps/web/src/shell/art/`). `Empty` prend une image à la place de son icône. Posés sur les états où l'écran entier est vide : Suivi (agence et chatteur), historique des alertes, Membres, Planning de l'équipe et du chatteur, Mes liens, Mes factures, Quinzaines, Documents, Objectifs, dossier de Moi, Ventes de la créatrice, Scripts (aucun script, rien à recopier), page introuvable. Captures : lots `illustrations-vides-1` et `illustrations-vides-2`, validés.
Pas fait : Contenu de la créatrice, liste Créatrices vide, panneau de l'extension (avec leurs fils) ; l'appareil photo et la couronne sont dessinés mais pas encore posés ; le dessin du coffre reste chez Médias jusqu'à sa fusion.
Décisions : un dessin seulement quand l'écran entier est vide, jamais dans une petite carte, ni sur un filtre sans résultat, une erreur ou un chargement. Aucune ADR touchée.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : tests des dessins et d'`Empty`, suite web entière, pnpm check.
