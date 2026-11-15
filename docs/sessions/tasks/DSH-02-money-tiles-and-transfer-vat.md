# DSH-02 Le Dashboard de l'agence : l'argent sur des tuiles séparées, et la TVA des virements
Statut : done (#719 fusionnée le 13/11 ; correctif d’arrondi des pourcentages de « Où va l’argent » en PR à part)
Phase : pilotage (ADR 0078, ADR 0106)
Dépend de : DSH-01, registre des ventes (ADR 0050)
Branche : claude/project-thread-t7tj46
Propriétaire : Recette Design/UX (écran) ; Bilan (contrat, domaine) ; relecteurs Design, Équipe, Bilan

## Objectif
Comme sur Reveal : chiffre d'affaires, net, part de la créatrice et part de l'agence sur des tuiles séparées, les parts en pourcentage du net ; où va l'argent en une barre ; et l'estimation de la TVA que la plateforme ajoute aux virements de l'agence.

## Contexte à lire
ADR 0106, ADR 0078, ADR 0054 § 2.

## À faire
- [x] Contrat : `revenueExclVatMinor` et `agencyTransferVatMinor` dans `AgencyFigures`.
- [x] Domaine `supervision` : somme du HT, `agencyTransferVat` (20 % de la part de l'agence, jamais sous zéro), testés.
- [x] Écran : quatre tuiles d'argent, « Où va l'argent », tuiles des fans et des ventes ; tests.
- [x] Lot argent-tuiles-tva validé (13/11 1 h 08).
- [x] Amendement § 10 à § 14 (« ok phrases 0106 ») : une couleur par destination, bulles au centime, appui au téléphone ; défauts du lot 1 corrigés (phrase de la bulle en gris, montants de la légende alignés).
- [ ] Lot argent-tuiles-tva-2 validé par Charles.

## Critères d'acceptation
- Aucun montant recalculé avec le pourcentage d'une créatrice ; la TVA des virements n'est jamais additionnée à rien.
- Aucune migration ; aucune valeur réelle dans les tests ou les captures.

## Hors périmètre
Lecture du montant exact des virements (l'API de Reveal n'a pas de route de virement).
