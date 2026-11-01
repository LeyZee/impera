# EQ-16 S'entraîner : les recrues s'exercent contre des fans simulés
Statut : blocked (ID validé par Charles le 27/10/2026, 15h11 : « je les veux tous » ; attend les clés comme le playground)
Phase : équipe (ADR 0023, ADR 0024), après le playground (P3-01, P3-05) et les clés
Dépend de : EQ-10 (espace du chatteur), EQ-11, P3-01 et P3-05 (fans simulés, préréglages, notes), les clés des fournisseurs
Branche : task/eq-16-recruit-practice

## Objectif
Un nouveau chatteur s'exerce à la méthode de l'agence contre des fans simulés avant son premier vrai fan, et chaque message reçoit un retour précis ; le propriétaire et le manager voient sa progression.

## Contexte à lire
`docs/adr/0024-roles-and-navigation.md` (un chatteur ne voit jamais Entraîner ni la persona), `apps/api/src/modules/playground/` (`fan-presets.ts`, fans simulés), P3-01, P3-05, `evals/` (rubriques), la méthode de chatting (`/mnt/project-files/chatting/methode-chatting.md`, hors dépôt), le plafond de dépense IA (20 € par jour, dur). Dans le playground, l'agent répond au fan simulé ; ici, c'est la recrue qui répond. On s'entraîne dans Nirvana ; en vrai, le chatteur chatte dans Reveal (ADR 0025), et ce qu'il y tape échappe aux gardes : l'entraînement est sa principale protection.

## À faire
- [ ] **S'entraîner** (`practice_session`) dans l'espace du chatteur, depuis Aujourd'hui (mis en avant tant que le membre porte le badge « nouveau »), jamais dans l'onglet Entraîner : la recrue choisit une situation parmi les préréglages de fan (nouveau, chaud, négocie, détresse…), un fan simulé lui écrit, elle répond.
- [ ] **Persona d'exemple** par défaut (inventée, comme Nora Vidal, ADR 0010) : la recrue apprend la méthode sans voir la persona d'une vraie créatrice. S'exercer dans la voix d'une créatrice de l'agence est un choix du propriétaire, créatrice par créatrice, et ne montre qu'un guide de voix, jamais la fiche entière.
- [ ] **Retour par message**, par un juge IA qui suit les rubriques des évals : ce qui est juste, ce qui casse la méthode (vente trop tôt, remise, promesse de rencontre, réponse trop longue…), et ce que les gardes dures bloqueraient en vrai. Le juge décrit, le code décide du score (le modèle décrit, le code décide).
- [ ] **Progression** visible par la recrue (dans S'entraîner), par le manager et le propriétaire (fiche du membre) : sessions faites, score par situation, points à revoir. Pas de classement entre chatteurs.
- [ ] **Coûts** : chaque session compte dans le plafond de dépense IA de l'agence ; un quota par membre et par jour, réglé par le propriétaire ; quota ou plafond atteint → message clair, jamais une erreur brute.
- [ ] Aucun vrai fan, aucune vraie conversation, aucun envoi : la session vit hors des tables `conversations` ; elle est gardée pour la progression, avec une durée de conservation réglable.
- [ ] Écrans pensés d'abord pour le téléphone, design system, aucune durée en dur ; le fan simulé est signalé comme tel à chaque écran.

## Critères d'acceptation
- Tests : une session d'entraînement n'écrit rien dans `conversations` ni dans les tables de vente ; le quota par membre bloque la session suivante avec le bon message ; le plafond de l'agence atteint coupe l'entraînement avant l'agent ; un chatteur ne lit jamais la persona d'une créatrice par ces routes.
- Évals : le juge reconnaît, sur des réponses écrites à la main, une remise, une promesse de rencontre et une vente avant le KYC.
- Finition (Charles, 27/10, 15h22 : « que ce soit vraiment très joli… des hovers partout… une belle hiérarchie des informations ») : chaque écran passe la barre de `docs/design/README.md` § Finition d'un écran, preuves comprises (captures Nuit et Jour, bureau et téléphone, mouvement réduit).

## Hors périmètre
Coach sur les vraies conversations d'un chatteur (signaux de coaching, plus tard), classement, certification.

## Notes de session
