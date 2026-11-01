# EQ-11 Shell par rôle : rail, barre du téléphone et gardes de route
Statut : done (met en œuvre l'ADR 0024, acceptée par Charles le 27/10/2026)
Phase : équipe (ADR 0024)
Dépend de : ADR 0024 ; le rôle d'équipe dans `/v1/me` (EQ-01, livré : contrat `MeSchema`, champs `team` et `teamScope`)
Branche : task/eq-11-role-based-shell

## Objectif
Le rail, la barre du téléphone et les routes du CRM dépendent du rôle, avant le premier écran de l'équipe : chacun ne voit que ce qui le concerne.

## Contexte à lire
`docs/adr/0024-roles-and-navigation.md` en entier, `docs/design/README.md` (gestes des icônes, verre seulement sur ce qui flotte, contenu sur plaques), `packages/design-system/README.md`, le shell actuel d'`apps/web` (`AppShell`, routeur, `shell.css`, `SubNav`), la relecture du fil propriétaire d'`apps/web` sur #157.

## À faire
- [x] Configuration du rail par rôle (propriétaire, manager, chatteur) dans l'ordre de l'ADR 0024, à la place de la liste statique ; `NavItem.to` élargi aux routes nouvelles, en français comme les routes existantes (`/creatrices`, `/suivi`, `/reglages`) : `/aujourdhui`, `/equipe`, `/paie`, `/planning`, `/commissions`, `/moi`. La créatrice a sa PWA (EQ-09).
- [x] Choix du rail depuis `/v1/me` (`MeSchema`) : `role = owner` → propriétaire ; `teamScope = agency` → manager ; sinon, une ligne d'équipe (`team` non nul) → chatteur, y compris un manager hors statut actif, comme son scope ; un `operator` sans ligne d'équipe garde le rail d'un operator d'aujourd'hui ; une `creator` garde le rail d'aujourd'hui jusqu'à sa PWA (EQ-09). Le rail et les gardes sont une fonction pure de `Me`, pour que « Voir comme » (EQ-19) n'ait qu'à changer `Me` dans le contexte du routeur.
- [x] Un onglet n'apparaît que lorsque son écran existe : pas d'onglet vide ni grisé.
- [x] Intertitres discrets Chatting et Agence dans le rail ; la lentille suit sans changement.
- [x] Gardes `beforeLoad` sur `context.user` : une route interdite ramène sur le premier onglet du rôle (Aujourd'hui pour un chatteur, dès qu'EQ-10 le livre ; le Dashboard pour un manager). Les refus du serveur restent la vraie barrière.
- [x] Téléphone : cinq emplacements, dont **Plus** quand il en faut davantage ; Plus ouvre une feuille de verre, qui est un dialogue modal accessible (focus piégé dedans, fermeture par Échap, par un appui dehors et au choix d'un onglet, retour du focus sur Plus) ; `sectionOf` rattache les sections débordées à Plus pour que l'onglet actif reste juste.
- [x] Icônes Équipe, Paie, Moi et Plus, chacune avec son geste, dessinées dans le design system.
- [x] Sous-onglets en sous-chemins (`/equipe/planning`, `/paie/factures`) : `sectionOf` les rattache à leur onglet.
- [ ] Vérifier l'en-tête de la Paie entre 821 et 1 100 px de large ; repli : défilement horizontal de la `SubNav`. Reste à la première PR d'écran de la Paie (EQ-05), qui seule a ses six sous-onglets.

## Critères d'acceptation
- Tests : chaque rôle voit exactement ses onglets, dans l'ordre de l'ADR 0024 ; un chatteur qui ouvre `/reglages` revient sur le premier onglet de son rôle ; la feuille Plus se ferme par Échap et garde le focus ; sur téléphone, Plus est actif quand la section affichée y est rangée.
- Le rail du propriétaire suit l'ADR 0024 dès cette PR : ses onglets, leur ordre et l'intertitre Chatting ; l'intertitre Agence n'apparaît que lorsque Équipe ou Paie existe.
- Aucune durée en dur ; captures avant et après, ordinateur et téléphone, Nuit et Jour.
- Finition (Charles, 27/10, 15h22 : « que ce soit vraiment très joli… des hovers partout… une belle hiérarchie des informations ») : chaque écran passe la barre de `docs/design/README.md` § Finition d'un écran, preuves comprises (captures Nuit et Jour, bureau et téléphone, mouvement réduit).

## Hors périmètre
Les écrans de l'équipe (EQ-01 à EQ-06, EQ-10), la PWA de la créatrice (EQ-09).

## Notes de session
- 2026-10-27 (fil Extension) : livré. `apps/web/src/shell/nav.ts` porte le rail de chaque rôle, fonction pure de `Me` (`railKindOf`, `layoutRail`, `railOf`) ; `READY_SECTIONS` liste les écrans qui existent, et un écran nouveau s'y ajoute avec sa route. Choix faits : une famille n'a d'intertitre qu'avec deux onglets ou plus (une Créatrices seule est précédée d'un espace) ; le téléphone garde d'abord les onglets de la colonne « Téléphone » de l'ADR, puis l'ordre du rail ; un rail d'un à trois onglets devient une capsule ajustée et centrée sur téléphone ; la pastille de l'agent n'apparaît que dans un rail qui a le Dashboard. Icônes Aujourd'hui, Planning, Commissions (celle de la Paie) ajoutées en plus des quatre de l'ADR, pour que le rail du chatteur soit prêt. Captures : https://claude.ai/artifact/DsMmvM9rVEManFv4phFw3q (avant et après, Nuit et Jour, bureau et téléphone, mouvement réduit, et le rail complet de demain).
