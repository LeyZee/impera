# DSH-05 Le Dashboard de l'agence en couleurs : l'agence en bleu, la courbe selon la tendance, une petite courbe par tuile d'argent
Statut : done
Phase : pilotage
Dépend de : DSH-02 (ADR 0106), DSH-04 (ADR 0146)
Branche : claude/project-thread-v704ot
Propriétaire : fil « Aligner le dashboard sur Reveal » ; relecteurs Design (apps/web, jetons), Bilan (contrats, serveur)

## Objectif
Donner au Dashboard la couleur que Charles a demandée le 17/11 : part des créatrices en rose, part de l'agence en bleu, courbe du chiffre d'affaires verte au-dessus de la période comparée et ambre en dessous, une petite courbe au pied des tuiles d'argent.

## Contexte à lire
ADR 0106 (§ 10 à § 14 et l'avenant du 17/11), ADR 0146 § 4 et § 5, ADR 0144 (le MCP ne lit jamais les parts).

## À faire
- [x] Jetons de Design : `--nv-money-agency` bleu, `--nv-trend-up`, `--nv-trend-down`, `--nv-kind-1..4` (Nuit et Jour).
- [x] Avenant du 17/11 dans l'ADR 0106.
- [x] Contrat et domaine : `agencyMinor` et `creatorMinor` par jour (un remboursement sur le jour de sa vente, arrondi par jour) ; tests : somme des jours, dollars, MCP sans les parts, manager comme propriétaire.
- [x] Écran : courbe du chiffre d'affaires selon la tendance, une petite courbe sous Net seulement (Charles, 19/11 : les parts redessinaient la même forme) ; sortes de vente en cyan (choix B de Charles, 19/11), agence au bleu du logo ; tests.
- [x] Captures Nuit/Jour, PC/téléphone, données inventées, en deux lots (courbe et tuiles ; barres et anneau A neutre / B sarcelle).
- [x] Avis Design, puis « ok captures » de Charles (19/11 : B cyan, bleu du logo, une seule petite courbe).
- [ ] OK de Design et de Bilan sur le dernier commit.

## Critères d'acceptation
- La couleur de la courbe dit la même chose que le pourcentage à côté ; jamais rouge.
- Les parts par jour suivent les droits des totaux ; le MCP ne les voit pas.
- Aucune valeur réelle dans les tests, la doc ou les captures.

## Hors périmètre
Le bleu exact du logo (si Charles le donne, seul le jeton change) ; l'étiquette du dernier jour des barres au téléphone (fil Design).
