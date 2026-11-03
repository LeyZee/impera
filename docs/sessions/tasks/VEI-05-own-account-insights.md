# VEI-05 Statistiques du compte de la créatrice comme signaux
Statut : blocked (PUB-02 : compte pro, appli Meta)
Phase : veille (ADR 0060)
Dépend de : PUB-02, VEI-04
Branche : task/vei-05-own-insights
Propriétaire : Bilan (connecteur)

## Objectif
Ses médias et leurs statistiques, lus chaque nuit par son connecteur Instagram, nourrissent son profil et deviennent des signaux.

## Contexte à lire
ADR 0057 § 2 et § 3, ADR 0060 § 2 (source 1) et § 3.

## À faire
- [ ] Lecture nocturne des médias et statistiques par le port du connecteur, contre `FakeInstagram`.
- [ ] Jamais le texte ni le nom d'un commentateur ; ses propres médias, légendes et statistiques, oui.

## Critères d'acceptation
- Tests contre le faux.

## Hors périmètre
Les comptes de référence (VEI-06).

## Notes de session
