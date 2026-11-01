# Premiers pas, palette de commandes et raccourcis
Statut : proposed (ID à donner par Charles ; née de l'étude de Desirely du 27/10)
Phase : interface
Dépend de : coquille `apps/web`, design system (`packages/design-system`)
Branche : task/<id>-first-steps

## Objectif
Un propriétaire qui ouvre Nirvana pour la première fois sait quoi faire dans l'ordre, et un habitué va partout au clavier.

## Contexte à lire
`docs/design/README.md`, `apps/web/src/` (rail par rôle), `docs/reference/desirely-analysis.md` (§ Interface).

## Ce que fait Desirely
Guide « Premiers pas » en étapes cochées (connecter un compte, synchroniser les médias, remplir le profil, créer des scripts, régler les horaires, activer l'IA), palette ⌘K, raccourcis « g » puis une lettre pour changer de page.

## À faire
- [ ] Premiers pas (propriétaire) : carte sur le Dashboard, placée sous le héros et sans néon, pour ne pas faire un second héros (l'action du héros reste la seule) ; étapes lues dans l'état réel (clés posées, compte Reveal relié, persona active, médias décrits, heures réglées, Telegram testé), chacune avec son lien ; étapes faites cochées en encre, progression en jauge neutre ; la carte disparaît quand tout est fait ; aucune étape factice.
- [ ] Palette ⌘K (Ctrl K) : pages, créatrices, réglages, actions sûres seulement (jamais un envoi ni une approbation). C'est un combobox accessible (`aria-activedescendant`) qui flotte en verre, s'ouvre sans rebond en mouvement réduit, et n'existe pas sur téléphone, où il n'y a pas de clavier.
- [ ] Raccourcis « g » puis lettre, listés par « ? » ; désactivés dans un champ de saisie ; ils ne prennent aucune touche déjà utilisée par un écran (flèches du `nv-seg`, Échap des dialogues, Tab des pièges de focus).

## Critères d'acceptation
- Nuit et Jour, 1 440 et 400 px, mouvement réduit, état « Le serveur ne répond pas » ; navigation au clavier testée ; animations du design system.

## Hors périmètre
Le tutoriel du chatteur (EQ).

## Notes de session
