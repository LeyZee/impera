# 2026-11-26 · Les guides à côté de leur écran

- **Fil** : Guides. **Branche** : `claude/project-thread-f101no` (repartie de main après #1013).
- **Fait** : sous le titre de 20 écrans, une ligne « Pas à pas » qui nomme les guides du geste qui s'y fait ; ouverte, les guides repliés, ceux du livre de la personne, dans sa couleur. Table `GUIDES_BESIDE` (adresse, rôle, guides), posée une fois dans `PageHeader` par un contexte que fournit `AppShell` : aucun écran n'est touché un par un. `AUDIENCE_COLOUR` et `audienceOf` passent de `HelpPage` à `help/beside.tsx`.
- **Pas posé** : Réglages › Sauvegardes, qui a déjà « Comment se joue un essai ».
- **Tests** : table (écrans qui existent dans le routeur, guides du bon livre), lecture de l'adresse, rendu dans l'en-tête plié, rien sur un écran sans guide. Un test de Créatrices visait `/Ta fiche/` et trouvait aussi le guide de la persona : visé plus précisément.
- **Captures** : `recette/2026-11-26/guides-a-cote/`, quatre écrans (Dashboard du propriétaire, Planning d'équipe du manager, Planning du chatteur, Contenu de la modèle), plié et ouvert.
- **Découvertes** : rien de nouveau.
