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
- [x] Port `ShiftRemarkSource` (type figé avec le fil Agent, 27/11) ; sans lui, chaque bilan est vide. Branchement à faire quand le module `agent` le livre.
- [x] Migration 0281 (numéro donné par Bilan le 27/11) : niveaux par code de faute (saisis hors dépôt), explications, contestations, dossiers ; FORCE RLS, `REVOKE ALL`, `GRANT` explicites.
- [x] Routes `/v1/team/review` : « Mon bilan » d'un shift, « vu », contestation, décision ; balayage d'isolation.
- [x] Écran « Mon bilan » dans Aujourd'hui selon la maquette validée (v3), captures du 27/11 ; le gain de « Bien fait » prend `--nv-success`, à confirmer par Design.
- [x] Tests : domaine, contrat, intégration (RLS, store, isolation), écran.
- [ ] OK Design et Sécurité, « ok captures » de Charles.
- [ ] Brancher la source des remarques du module `agent` quand il la livre.

## Ensuite
EQ-29 « À trancher » pour le propriétaire et les alertes dès la première fois ; EQ-30 les primes proposées.
