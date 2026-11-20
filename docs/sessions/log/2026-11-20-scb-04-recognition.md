# 2026-11-20 — SCB-04 Éditeur des scripts, lot 2 reconnaissance — in_progress
Fait : après chaque import des scripts natifs, un script « prêt à copier » est rattaché au script natif qui lui correspond en tout (nom, étapes, branches par rang, médias vendus, prix) ; ordre et conditions passent dans `platform_script_branches` (le rôle de service y insère, migration 0230), le script en préparation est fermé (`matched`, audit `prepared_script.matched`) ; la lecture dit ce qui diffère (`copyDifferences`).
Pas fait : teaser, messages après le média et rythme ne sont pas encore lus par le déroulé (lot 3 du moteur) ; écran (lot 3), Performances (lot 4).
Décisions : textes non comparés (le texte de Reveal est celui qui part) ; un script natif déjà réglé par l'agence ou déjà pris n'est jamais rattaché ; le plus ancien script prêt passe d'abord.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test ; intégration locale (scripts natifs, scripts en préparation, droits du rôle de service).
