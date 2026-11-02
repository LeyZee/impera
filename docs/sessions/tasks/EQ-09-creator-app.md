# EQ-09 PWA de la créatrice : routine, revenus, qui est en poste
Statut : done (remplacée le 02/11/2026 par les fiches CR-01 à CR-07, après les ADR 0042 à 0044 acceptées par Charles ; rien n'est plus à faire ici, voir la note de session) (lot 5 de l'ADR 0023, ID validé par Charles le 27/10/2026)
Phase : 5
Dépend de : EQ-01, EQ-02, EQ-04, ADR 0024
Branche : task/eq-09-creator-app

## Objectif
Donner à chaque créatrice une application installable sur son téléphone : sa routine du jour, ses revenus, ses factures, qui chatte pour elle maintenant, et des notifications.

## Contexte à lire
`docs/adr/0023-team-management.md`, `docs/roadmap.md` (phase 5), `apps/web/README.md`, `docs/design/README.md`. Concepts d'origine (Imperium) : routine à deux couches, série fondée sur les tâches essentielles et non sur 100 %, « journée parfaite », push obligatoire pour une facture, heures calmes.

## À faire
- [ ] Module `creator-tasks` : tâches de l'agence (non supprimables par la créatrice, comptent pour la série), tâches personnelles (rappel à l'heure choisie, hors série), complétions idempotentes par jour dans le fuseau de la créatrice, série et « journée parfaite » calculées par le serveur.
- [ ] Écran propriétaire : la routine de chaque créatrice et sa régularité.
- [ ] PWA sous `/app` pour le rôle `creator` : Accueil (routine, qui est en poste), Ma semaine, Revenus (« parcours de ton argent »), Factures, Réglages des notifications. Manifeste, service worker, hors ligne de l'enveloppe, Web Push (clés VAPID en configuration, jamais dans le dépôt).
- [ ] Notifications : vente (groupées en rafale, heures calmes), rappel de routine, série en danger, facture (jamais coupée).

## Critères d'acceptation
- Tests : jour compté dans le fuseau de la créatrice (passage de minuit, heure d'été), double coche sans doublon, série qui casse puis repart.
- La créatrice ne lit jamais une conversation ni un fan (test d'intégration RLS).
- Vérification sur un vrai iPhone installé (zone sûre, notifications).
- Finition (Charles, 27/10, 15h22 : « que ce soit vraiment très joli… des hovers partout… une belle hiérarchie des informations ») : chaque écran passe la barre de `docs/design/README.md` § Finition d'un écran, preuves comprises (captures Nuit et Jour, bureau et téléphone, mouvement réduit).

## Hors périmètre
Projets de la créatrice, liens et trafic, ventes Telegram Stars, gamification au-delà de la série.

## Notes de session
- 2026-11-02 (fil des espaces) : l'ADR 0042 refait l'espace de la créatrice et la fiche est remplacée : socle installable, Web Push, heures calmes et clés d'accès dans CR-01 (clés VAPID créées par le serveur et chiffrées en base, plus en configuration) ; accès et lecture de son compte dans CR-02 ; revenus au jour le jour dans CR-04 ; routine, série, tâches de l'agence et personnelles (module `creator-tasks`) dans CR-05 ; « qui est en poste » dans CR-12 ; topo de la semaine dans CR-07. Les factures de la créatrice ne sont plus dans son espace (ADR 0042 § 6). Aucun code n'avait été écrit pour cette fiche.
