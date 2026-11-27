# EQ-24 « Où te verser » : où un membre reçoit ses virements
Statut : in_review (trou n° 5 de la grande recette du 21/11 ; « attaque les 18 écrans », Charles, 21/11)
Phase : équipe (ADR 0023 § Factures, ADR 0165)
Dépend de : EQ-05 (« Marquer payé »), EQ-15 (connexion récente), CR-01 (notifications)
Branche : claude/project-thread-cohhca-payout

## Objectif
Le propriétaire verse chaque relevé par WorldRemit sans chercher le numéro ailleurs. Le chatteur écrit lui-même où le verser (mobile money, compte bancaire ou retrait en espèces) dans Moi › Dossier ; le propriétaire le lit à côté de « Marquer payé », un membre à la fois.

## Fait
- [x] ADR 0165 (proposée) et avis de Sécurité du 21/11 : bloc scellé avec `CREDENTIALS_ENCRYPTION_KEYS`, contexte membre et version ; écriture par le membre seul avec connexion récente ; lecture par lui et le propriétaire, qui révèle un membre à la fois, journalisé ; aucun accès du rôle de service ; `Cache-Control: no-store` ; 3 changements par jour au plus.
- [x] Table `payout_destinations` en ajout seul (migration 0279), FORCE RLS, déclencheur `refuse_change`, aucun GRANT à `impera_service` (`CLOSED` du test du rôle de service).
- [x] Routes : `GET /v1/payroll/payout-destinations` (propriétaire, sans numéro), `GET` et `PUT …/contractors/:memberId/payout-destination` (le membre), `POST …/reveal` (propriétaire, connexion récente).
- [x] Journal : `payout_destination.update` (façon de recevoir et version, jamais une valeur), `payout_destination.reveal`.
- [x] Notification `payout_change` au membre sur chacun de ses appareils, même en heures calmes, par le job `payroll.notify_payout_change`.
- [x] Rotation des clés : `pnpm ops:reencrypt-credentials` ajoute une version « re-scellée » (jamais un UPDATE), `pnpm ops:check-keys` vérifie la version en vigueur.
- [x] Écrans : carte « Où te verser » dans Moi › Dossier ; ligne « Où le verser » dans « Marquer payé », ambre si changé depuis moins de 7 jours, « Afficher » puis « Copier le numéro ».

## Reste
- Mot de Charles sur la règle d'argent « le propriétaire ne saisit jamais pour lui » (carte de décision du 21/11), avant fusion.
- Captures Nuit/Jour, PC/téléphone, avis de Design, OK de Sécurité sur le sha.
- Membre parti : lecture et écriture de la sienne dans l'espace de départ (EQ-14, trou n° 10).

## Critères d'acceptation
- Tests d'intégration (`payout-destinations.integration.test.ts`) : isolation, manager refusé partout, propriétaire refusé en écriture (route et base), connexion trop ancienne refusée, bloc recopié illisible, audit sans valeur, UPDATE/DELETE refusés, rôle de service refusé, limite du jour, re-scellement sans changement visible, rien gardé sans clé.
- Tests d'écran (`PayoutCard.test.tsx`). Aucune vraie coordonnée (ADR 0010).
