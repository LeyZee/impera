# DSH-04 Le Dashboard de l'agence par jour, semaine, mois ou période choisie, et la comparaison choisie
Statut : done (ADR 0146 acceptée par Charles le 17/11 ; captures dashboard-periodes-4 validées ; fusion sur signal du coordinateur)
Phase : pilotage
Dépend de : DSH-01 (ADR 0078), DSH-02 (ADR 0106)
Branche : claude/project-thread-v704ot
Propriétaire : fil « Aligner le dashboard sur Reveal » ; relecteurs Design (apps/web), Bilan (contrats, serveur)

## Objectif
Lire « L'agence en chiffres » sur les mêmes jours que Reveal : un jour, une semaine du lundi au dimanche, un mois civil ou des jours choisis, avec des flèches, et une comparaison choisie. La courbe sous le chiffre d'affaires donne la valeur de chaque jour au survol et ne se tasse plus à droite quand le registre est jeune.

## Contexte à lire
ADR 0078 § 3 et § 5, ADR 0146, ADR 0081 § 4, glossaire « Période comparée » et « Premier jour du registre ».

## À faire
- [x] ADR 0146 (proposée).
- [x] Contrat : `unit`, `at`, `from`, `to`, `compareAt` dans la requête ; `span`, `registerSince`, `previousDays` dans la réponse ; `period` gardé pour le MCP.
- [x] Domaine `supervision` : `agencySpan`, `periodAround`, comparaison coupée au même nombre de jours, refus d'une comparaison qui ne finit pas avant ; tests.
- [x] Lecteur : fans de la période comparée sans les jours entre les deux ; premier jour du registre ; test d'intégration.
- [x] Écran : Jour / Semaine / Mois / Personnalisé, flèches, liste des périodes, liste des comparaisons, courbe avec comparaison et survol, aucun pourcentage quand le registre ne couvre pas la comparaison ; tests.
- [ ] « ok 0146 » de Charles.
- [ ] Avis Design avant captures, captures Nuit/Jour, PC/téléphone, données inventées ; « ok captures ».
- [ ] OK de Design et de Bilan sur le dernier commit.

## Critères d'acceptation
- Mois en cours ouvert par défaut ; la comparaison d'une période en cours couvre le même nombre de jours.
- `stats_get` du MCP inchangé.
- Aucune valeur réelle dans les tests, la doc ou les captures.

## Hors périmètre
Le bloc de l'agent d'une créatrice (ses périodes glissantes restent), les définitions de Reveal (abonnements gratuits comptés comme ventes).
