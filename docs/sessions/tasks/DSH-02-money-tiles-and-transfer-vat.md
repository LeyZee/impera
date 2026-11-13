# DSH-02 Le Dashboard de l'agence : l'argent sur des tuiles séparées, et la TVA des virements
Statut : review (PR en brouillon ; captures Nuit/Jour, PC/téléphone à valider avant fusion)
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
- [ ] Captures Nuit/Jour, PC/téléphone validées par Charles.

## Critères d'acceptation
- Aucun montant recalculé avec le pourcentage d'une créatrice ; la TVA des virements n'est jamais additionnée à rien.
- Aucune migration ; aucune valeur réelle dans les tests ou les captures.

## Hors périmètre
Lecture du montant exact des virements (l'API de Reveal n'a pas de route de virement).
