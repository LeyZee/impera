# D-01 Design system « Liquid Glass »

Statut : in_progress
Phase : 4 (à livrer avant le premier écran du dashboard, après P0-07a)
Dépend de : P0-01
Branche : task/d-01-design-system

## Objectif
Donner à Nirvana une identité visuelle moderne et épurée inspirée du Liquid Glass d'iOS 26 et 27, sous forme de tokens Tailwind v4, de composants shadcn/ui restylés et d'un guide, sans compromettre l'usage au clavier ni la lisibilité.

## Contexte à lire
`docs/design/brief.md` (intention, contraintes, livrables, questions ouvertes), `apps/web/README.md`, `docs/architecture/message-flow.md` (mode copilote), `brand/banner.svg` (bannière actuelle, logo dans `brand/README.md`).

## À faire
- Trancher les questions ouvertes du brief avec Charles (identité propre ou tokens IMPERA ; maquettes ou code) et consigner la réponse dans `docs/design/README.md`.
- `apps/web/src/styles/tokens.css` : `@theme` Tailwind v4 (couleurs, surfaces vitrées à 3 niveaux, rayons, ombres, bords, flous, typographie, espacements, animations), modes sombre et clair.
- Restyler les composants shadcn/ui de base (bouton, carte, panneau latéral, dialogue, toast, badge, interrupteur, champ) ; ajouter bulle de message, carte de conversation, panneau de draft.
- Page `apps/web/src/routes/_playground.tsx` (dev seulement) qui montre tous les composants dans les deux modes.
- `docs/design/README.md` : règles du verre (où oui, où non), états, animations, accessibilité, performance.
- Mesurer : contraste AA sur chaque surface vitrée ; `backdrop-filter` absent des lignes de liste ; `prefers-reduced-motion` respecté.

## Critères d'acceptation
- La page playground rend tous les composants en sombre et en clair sans régression de contraste (vérifié par un test axe-core en CI).
- Le guide est relu et accepté par Charles.
- Aucune dépendance d'UI ajoutée hors shadcn/ui, Radix et Tailwind.

## Hors périmètre
Les écrans fonctionnels (inbox, conversation, fan, supervision) : ils arrivent en phase 4 et consomment ce design.

## Notes de session

2026-10-16 (Opus 5.5, à la demande de Charles, avant P0-01) :
- Questions du brief tranchées par Charles : identité propre, néon rouge sur nuit, en code. Consigné dans `docs/design/README.md`.
- Le design system sert aussi le popup de l'extension : tokens et classes dans `packages/design-system` au lieu de `apps/web/src/styles/` (ADR 0015 proposed). `apps/web` importera `tokens.css` et `theme.css` depuis le package.
- Fait : tokens (Nuit, Jour), pont Tailwind v4, classes de composants (verre, boutons, segments, interrupteur, barre d'onglets, carte de conversation, pastilles d'état, bulles, panneau de brouillon, champ, faits, Island, popup), aides d'animation, test de contraste AA dans les deux thèmes, guide.
- Reste, bloqué par P0-01 : restyler les composants shadcn/ui, `apps/web/src/routes/_playground.tsx`, test axe-core en CI. `pnpm check` non exécuté (pas de `pnpm install` avant P0-01) ; typecheck strict et tests (27) vérifiés à part.

2026-10-19 (Opus 5.5, refonte demandée par Charles : « ça fait cheap et daté ») :
- Revue onglet par onglet et lecture d'iOS 26 et 27 : cinq causes, consignées dans `docs/design/README.md` (« Refonte du 19/10 »).
- Fait dans le package : verre clair réservé à la couche qui flotte, plaques de contenu (`nv-plate`), une seule lumière néon et un grain, sélection neutre (`select`), focus blanc chaud, chiffres en Geist tabulaire, une famille de ressorts (`ease-spring-smooth`, `ease-spring`, `ease-spring-bouncy`), pression en gel, `nv-materialize`, liste « À traiter » en liste groupée, mouvement réduit qui gagne enfin sur les boucles (recette A-03), polices embarquées par Fontsource (recette R-G17 ; ce sont des fichiers de police, pas une dépendance d'UI).
- Reste : la coquille et les écrans dans `apps/web` (une PR par onglet, accord du fil Extension), puis les images du guide refaites à partir du CRM.

2026-10-22 (Opus 5.5, suite de la refonte) :
- Nouvelle direction publiée dans l'artefact du design system (même lien), avec le Dashboard maquetté sur bureau et téléphone, données d'exemple.
- Fait dans `apps/web` : coquille (barre latérale flottante en verre, icônes seules entre 821 et 1 100 px, capsule d'onglets en bas sur téléphone, la page défile sous la barre), en-têtes et panneaux en plaques, Dashboard sans cartes de verre (héros posé sur le fond, sections séparées par l'espace), point d'Arrêt rouge seulement quand l'agent est arrêté (recette R-C3).
- Reste : Créatrices, Entraîner (dont le `main` imbriqué du playground, recette R-C5), Suivi, Réglages, connexion (erreur en néon), une PR par onglet ; images du guide.

2026-10-23 (suite de la refonte) :
- Fait : Créatrices en plaques, alignée sur le titre, ambre pour ce qui reste à corriger, néon seulement sur « Enregistrer une version ».
- Reste : Entraîner (dont le `main` imbriqué du playground, recette R-C5), Suivi, Réglages, connexion (erreur en néon), une PR par onglet ; images du guide.
- Fait (demande de Charles du 23/10) : lueur du titre réservée à ce qui demande une action, un seul ressort (jetons `stagger` et `dur-data`, plus aucune durée en dur dans la coquille, le Dashboard et le Playground), thème Jour vérifié écran par écran.
- Fait : Entraîner sur plaques, un seul `main` (recette R-C5), sélection neutre, ambre pour une mauvaise note. Reste : Suivi, Réglages, connexion (erreur en néon) ; images du guide.
- Fait : Suivi, lecteur sur plaque, brouillon en teinte calme, non-lus sans néon. Reste : Réglages, connexion (erreur en néon) ; images du guide.
- Fait : Réglages (Modèles IA, Telegram) sur plaques, alignés sur le titre, sélection neutre, ambre pour ce qui reste à régler. Reste : connexion (erreur en néon) ; images du guide.
- Fait : connexion sur plaque, erreur en ambre, flamme du logo. Reste : images du guide.

2026-10-25 (suite de la refonte) :
- Fait : images du guide refaites depuis le CRM (Dashboard Nuit et Jour, Suivi, téléphone), palette et typographie rendues depuis `tokens.css`.
- Reste : passe téléphone (Playground) ; choix du thème Jour, en attente de Charles.
- Fait (choix de Charles du 25/10) : Réglages › Apparence, Nuit / Jour / Appareil, Nuit par défaut, gardé par le navigateur et posé avant le premier affichage. Reste : passe téléphone (Playground).
- Fait : passe téléphone. Le Playground tient l'écran au-dessus de la barre d'onglets, champ en pied comme dans Messages ; le pourquoi, le fan et le taux viennent dessous, dans le défilement de la colonne. Le taux sous l'objectif n'a plus qu'un ton (ambre). Les onglets d'une section trop larges pour le téléphone défilent dans leur capsule, bord estompé. Reste : rien sur D-01.
