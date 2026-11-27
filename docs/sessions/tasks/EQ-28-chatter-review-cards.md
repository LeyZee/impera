# EQ-28 Mon bilan : cartes de faute, niveaux, contestation
Statut : in_progress (« ok maquette bilan », catalogue des fautes validé, Charles, 26/11/2026)
Phase : équipe (ADR 0170 §§ B et 26 à 32)
Dépend de : EQ-27 (retour léger) ; la relecture et les remarques du module `agent` (fil Agent) ; l'auteur des messages humains (fil Bilan)
Branche : claude/project-thread-cohhca-chatter-bilan

## Objectif
Le chatteur lit, après chaque shift pendant son accompagnement puis chaque semaine, un bilan qui relève ce qui a nui à l'achat ou à la relation. Chaque faute est une carte : son niveau, ce qu'elle a coûté en euros, l'extrait redessiné, ce que le fan a ressenti, comment il aurait pu mener la conversation, la règle. Le niveau vient du code de la faute, le compteur et le dossier du code, jamais du modèle.

## À faire
- [x] Amendement de l'ADR 0170 (§§ 26 à 32).
- [x] Contrat : `FaultLevel`, `FaultCode`, `FaultTone`.
- [x] Domaine pur `team/domain/chatter-review` : compteur après explication, ton, ouverture d'un dossier, total manqué.
- [ ] Interface des remarques lues dans l'`index.ts` de l'agent (type à figer avec le fil Agent).
- [x] Migration 0281 (numéro donné par Bilan le 27/11) : niveaux par code de faute (saisis hors dépôt), explications, contestations, dossiers ; FORCE RLS, `REVOKE ALL`, `GRANT` explicites.
- [ ] Routes « Mon bilan » (chatteur) et contestation ; balayage d'isolation.
- [ ] Écran « Mon bilan » selon la maquette validée (v3) ; vérifier le vert du gain de « Bien fait ».
- [ ] Tests : domaine, contrat, intégration, écran.

## Ensuite
EQ-29 « À trancher » pour le propriétaire et les alertes dès la première fois ; EQ-30 les primes proposées.
