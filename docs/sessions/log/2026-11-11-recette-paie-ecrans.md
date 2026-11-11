# 2026-11-11 · Recette paie : petits correctifs d'écrans

Fait : tri par date des ventes en attente (`heldInOrder`) et renvoi vers Équipe › Reveal ; texte de bascule d'une quinzaine finie ; texte d'un relevé sur les ventes lues ; remboursements comptés dans le parcours de l'argent ; en-tête de Paie › Quinzaine qui suit aussi les ventes lues ; raison affichée quand Équipe › Reveal n'a personne à proposer (bot, prestataire, sans e-mail).
Vérifié : tests web mis à jour (`held-sales`, `model`, `reveal`, `PayRulesSection`, `PeriodPage`), `pnpm check` vert ; captures Nuit/Jour, PC/téléphone de chaque écran touché.
Reste : rien dans ce lot ; les points de Bilan et d'Équipe sont dans la fiche CRM-03.
Découvertes : dans Équipe › Reveal, un compte relié retiré de Reveal, sans nom ni e-mail, a montré une fois la valeur brute `member:<id>` dans sa liste ; « de suite : la » coupe la ligne avant les deux-points (espace ordinaire, pas insécable) dans les textes de report de Paie.
