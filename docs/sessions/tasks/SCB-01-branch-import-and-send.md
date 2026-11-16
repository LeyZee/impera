# SCB-01 Import et envoi des branches d'un script
Statut : in_progress (lot 1 de l'ADR 0112, PR ouverte le 16/11/2026)
Phase : scripts (ADR 0112)
Dépend de : SC-04 lot c8 (#781), import des scripts natifs (#761)
Branche : claude/project-thread-moagsx

## Objectif
Un script natif dont une étape a plusieurs branches se lit toujours dans le même ordre, s'envoie branche par branche et devient proposable une fois que l'agence a réglé chaque branche dans le CRM.

## Contexte à lire
ADR 0112 (§§ 1, 5, 6, 13, 14), ADR 0098, ADR 0099, fiche SC-04 (lot c8), module `scripts`, connecteur Reveal (`mapping.ts`, `connector.ts`).

## À faire
- [x] Ordre stable des branches d'un même rang (par `stepRef`) à la lecture Reveal et dans le plan d'import : l'empreinte ne change plus quand Reveal liste les branches dans un autre ordre.
- [x] Empreinte par branche (`platformStepFingerprint`), pour la version d'étape de l'ADR 0129.
- [x] Envoi d'une étape par son `stepRef` (`sendScriptStep`), plus jamais par sa place.
- [x] Réglages d'Impera gardés à chaque import (`platform_script_branches`, migration 0214) : ordre des branches et condition (aucune, structurée, texte) ; route `PUT …/platform-scripts/:scriptId/steps/:platformIndex/branches` (propriétaire, manager actif de sa liste), journalisée.
- [x] Manques précis à la place de `branched_step` : branche non réglée, deux défauts, branche moins chère sur condition de dépense, branche précédente inconnue, même média vendu deux fois ; avertissement « étape sans branche par défaut » ; prix de P6-01 chemin par chemin.
- [ ] Identité d'un script à branches écrite par le cerveau : son prompt lit les étapes à la suite ; d'ici là l'agence l'écrit à la main.

## Critères d'acceptation
- Tests unitaires des règles de branches, des prix par chemin, de l'ordre stable ; connecteur contre FakeReveal (branche envoyée par son `stepRef`) ; intégration : route, isolation (chatteur, compte de la créatrice, manager hors liste), réglages gardés après un nouvel import.
- Aucune donnée réelle.

## Hors périmètre
Choix de la branche par l'agent, rythme, messages après le média (lots 2 et 3), éditeur (lot 4), `script_writer` (lot 5).
