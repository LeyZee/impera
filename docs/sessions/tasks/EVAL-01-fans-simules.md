# EVAL-01 Des fans simulés testent l'agent sur des semaines fictives
Statut : in_progress
Phase : exploitation
Dépend de : OPS-11, ADR 0103 (Playground)
Branche : claude/project-thread-hjl68y

## Objectif (1 phrase)

Mesurer si l'agent lit un fan, trouve son fantasme et vend au bon moment sur des semaines, pas seulement sur trois messages.

## Contexte

- Demande de Charles du 26/11/2026 : une IA joue un fan complet (arrivé par un reel, s'abonne un soir) face à l'IA de la créatrice, comme au Playground ; puis un casting de 8 fans très différents ; « le but c'est l'argent », l'IA doit parler au fantasme précis du fan.
- Les passes 1 et 2 (évals courtes) plafonnent à 73-76 % et ne mesurent pas la relation dans la durée.
- Décision : brouillon d'ADR « fan simulé », numéroté par le fil Bilan.

## À faire (liste vérifiable)

- [x] Passerelle `createFanSimulationGateway` (`@impera/llm`) : `simulateFan` et `judgeRelationship`, rôle `judge` d'une configuration propre, sorties Zod, ses messages à elle et le journal en blocs non fiables, plafond du lancement.
- [x] Prompts `judge/fan-simulation.md` et barème d'exemple inventé `judge/relationship-example.md` (le vrai barème est hors dépôt, `--rubric`).
- [x] `pnpm fan-sim` : session du Playground, horloge simulée, relances entre les sessions, état caché tenu par le code, achats décidés par le code, mesures (KYC appris par jour, moule, offres, ressentis), sorties sous `.scratch/`.
- [x] Catalogue inventé à thèmes (`evals/fans/catalogue.yaml`) et Julien (`evals/fans/julien.yaml`).
- [ ] Les 7 autres fans du casting (dont un fantasme « bébé » entre adultes, un âge douteux, un fantasme qu'aucun script ne couvre).
- [ ] Semaine 1 des 8 fans sur le PC, sur le mot de Charles dans le fil Bilan ; puis 30 jours pour 2 ou 3.

## Résultat

En cours.
