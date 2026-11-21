# OPS-21 Le prévisionnel du coût de l'IA
Statut : review
Phase : exploitation
Dépend de : OPS-08
Branche : claude/project-thread-qy62zv

## Objectif
Charles voit, dans Réglages › Consommation IA, ce que l'IA lui coûtera ce mois-ci et le mois suivant, pour sa trésorerie (21/11/2026 : « des prévisionnels, le plus réalistes possible »).

## À faire
- Usages `media` et `telegram` dans `llm_calls`, posés par la passerelle sur ses appels dédiés (migration).
- Calcul pur du prévisionnel dans `ai-usage` : bas, réaliste et haut ; ce mois-ci et le suivant ; par usage et par créatrice ; avec 50 % de trafic en plus ; face au plafond du jour et aux ventes (ADR 0091 § 8).
- Bloc « Prévisionnel » dans l'écran, captures Nuit/Jour, PC/téléphone.

## Critères d'acceptation
- Le prévisionnel est absent avant une première journée complète, et le dit.
- Le chatting seul grandit avec le trafic ; le plafond qui coupe l'IA est dit en ambre.
- La part des ventes donne le coût de l'IA en pourcentage du net de Reveal, sans aucun taux de l'agence dans le code.

## Hors périmètre
Le coût par conversation qui a payé (relier ventes et conversations), une carte au Dashboard (fil « Choisir les métriques »).

## Notes de session
- 21/11/2026 : codé et testé ; attend l'avis Design, l'OK serveur du fil Bilan, l'avis Sécurité (plafond du rôle de service) et « ok captures prevision-ia-1 ».
