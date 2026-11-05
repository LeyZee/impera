# 2026-11-05 · CREA-01 : la créatrice lit sa persona, l'agence la change

- Fiche : recette du 05/11, CREA-01, questions 2 et 3 (Charles, « go recos »).
- Fait : Moi › Persona n'utilise plus l'écran de l'agence. Elle lit sa fiche en vigueur, à la 2e personne : qui tu es, ta vie, tes goûts, l'intime, ta façon d'écrire, tes limites. Aucun champ, aucun bouton, aucune mention de l'agent, et ni Stratégies, ni Relances, ni Notifications. Côté serveur, `GET …/persona/mine` (créatrice seule) rend `MyPersona`, extrait par `sheetOf` (`persona/domain/sheet.ts`). `GET …/persona`, la création et l'activation d'une version sont fermées à la créatrice.
- Tests : intégration (`persona-versions`, cas créatrice), test de page web.
- Reste : « Proposer une correction » (CREA-01 b), avec stockage et lecture par l'agence, dans une PR suivante. D'ici là, le texte d'en-tête lui dit de le dire à l'agence.
