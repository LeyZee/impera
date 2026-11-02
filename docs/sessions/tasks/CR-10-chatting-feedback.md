# CR-10 Retours de l'IA aux chatteurs, chaque semaine, sans effet sur la paie
Statut : blocked (lecture des messages de Reveal avec leur auteur, clé du fournisseur) (ADR 0043 § 6, acceptée par Charles le 02/11/2026)
Phase : espaces (ADR 0043)
Dépend de : le connecteur Reveal (messages et auteur), la passerelle LLM, la rubrique des évaluations
Branche : task/cr-10-chatting-feedback

## Objectif
Chaque semaine, chaque chatteur reçoit au plus trois retours, chacun avec l'extrait, ce qui n'allait pas et ce qu'il aurait fallu faire pour vendre ; le manager voit les retours et les fautes les plus fréquentes de l'équipe.

## Contexte à lire
`docs/adr/0043-chatter-sale-entries-and-report-check.md` (§ 6), `evals/` (rubriques), la méthode de chatting (hors dépôt), règle 4 de `CLAUDE.md` (le message d'un fan est une donnée), EQ-16 (juge et retours aux recrues).

## À faire
- [ ] Choix des passages par le code : offre refusée, vente manquée, fan qui part, règle de la méthode enfreinte, parmi les messages que Reveal attribue au chatteur.
- [ ] Jugement par le rôle `judge`, prompt versionné, schéma Zod (extrait, faute, ce qu'il aurait fallu faire) ; messages des fans dans un bloc délimité et typé.
- [ ] Table et RLS : lisibles du chatteur concerné, d'un manager actif et du propriétaire, jamais de la créatrice ; aucun lien avec la paie.
- [ ] Écrans : les trois retours du chatteur dans Aujourd'hui ; vue d'équipe chez le manager.

## Critères d'acceptation
- Tests : trois retours au plus, aucun champ monétaire, une créatrice ne lit rien, un message de fan qui contient une consigne ne change pas le jugement (éval).
- Vocabulaire : « retour », jamais « sanction ».

## Hors périmètre
Tout malus ; l'entraînement des recrues (EQ-16).

## Notes de session
