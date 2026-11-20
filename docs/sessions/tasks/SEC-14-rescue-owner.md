# SEC-14 Un compte propriétaire de secours
Statut : done
Phase : exploitation
Dépend de : SEC-02, SEC-04, EQ-10, EQ-18
Branche : claude/project-thread-bfbfaz (fil « Corriger les failles de l'audit sécurité »)

## Objectif (1 phrase)

Appliquer l'ADR 0096 : le propriétaire fait d'un membre de l'équipe un second propriétaire, et un propriétaire ne retire l'autre qu'après 72 h de préavis que le visé peut annuler.

## Contexte à lire (fichiers précis)

- ADR 0096, 0024, 0046, 0068 ; `docs/conventions/security.md` §6 ; `apps/api/src/security-settings.ts`, `apps/api/src/security-alerts.ts`, `apps/api/src/invitation-links.ts`.

## À faire (liste vérifiable)

- [x] ADR 0096 versée au dépôt (acceptée par Charles le 12/11/2026), index des ADR.
- [x] Contrat `owners` : deux propriétaires au plus, 72 h, les raisons d'un refus, les codes d'erreur.
- [x] Table `owner_removals` (le préavis est une contrainte de la table), fermée au rôle applicatif.
- [x] Routes de Réglages › Sécurité : lire, ajouter, demander un retrait, l'annuler ; les trois écritures sont des actions sensibles.
- [x] Tâche `owners.watch` : applique un retrait dont le préavis est passé, jamais le dernier propriétaire ; prévient les propriétaires dans l'application de chaque changement et d'une connexion de l'autre sur un nouvel appareil.
- [x] Alertes de sécurité (Telegram) et lignes du journal pour chaque geste.
- [x] Aucun autre geste ne ferme la porte à un propriétaire : statut de sa fiche de membre, lien de mot de passe, retrait de ses clés d'accès par l'autre.
- [x] Écran : le panneau « Propriétaires » de Réglages › Sécurité.
- [x] Captures validées par Charles (Nuit, Jour, bureau, téléphone).

## Critères d'acceptation (tests, commandes, comportements observables)

- `owners.integration.test.ts` : jamais un troisième ; un membre sans code actif ou hors de l'équipe est refusé ; le retrait attend 72 h, s'annule par le visé seul, s'applique une fois ; l'agence ne reste jamais sans propriétaire ; la table refuse un préavis plus court ; les trois gardes ; les notifications, une fois par événement et par compte.
- `owners.test.ts` (contrats et API), `OwnersPanel.test.tsx`, textes Telegram, règle des heures calmes.
- `pnpm check`, `pnpm test`, les suites d'intégration et la CI verts.

## Hors périmètre

- « Voir comme » un chatteur (EQ-19), dans une PR à part.
- La commande du serveur `pnpm owner:create` reste la voie de dernier recours et ne compte pas les propriétaires.

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- Le brouillon de l'ADR donnait le code à Bilan et la relecture à Sécurité ; le coordinateur a confié le code à ce fil le 20/11, Bilan relit.
- « Un compte invité » est lu comme un membre actif de l'équipe dont le code à 6 chiffres est actif. Sa fiche de membre reste ; retiré, il retrouve sa place dans l'équipe.
- Devenu propriétaire, ses sessions et ses liens d'extension sont fermés : il se reconnecte avec son code.
- Un seul retrait en attente à la fois, et rien d'autre ne change parmi les propriétaires pendant ce temps.
