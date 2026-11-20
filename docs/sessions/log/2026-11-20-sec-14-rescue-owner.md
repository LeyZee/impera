# 2026-11-20 — SEC-14 Un compte propriétaire de secours (ADR 0096) — in progress

Fait : ADR 0096 versée (acceptée le 12/11, jamais entrée au dépôt) ; contrat `owners` ; table `owner_removals` (migration 0233, préavis de 72 h en contrainte, fermée au rôle applicatif) ; routes de Réglages › Sécurité (lire, ajouter, demander un retrait, l'annuler) ; tâche `owners.watch` (applique un retrait passé son préavis, jamais le dernier propriétaire ; notifications `owner_change`) ; quatre alertes de sécurité et leurs textes Telegram ; trois gardes (`owner_protected_conflict`) ; panneau « Propriétaires ». Tests : contrat, API, intégration (7), écran (5).
Reste : captures à faire valider par Charles ; relecture de Bilan ; numéro de migration à refixer au tour de fusion.
Décisions : aucune ADR nouvelle. Lectures de l'ADR notées sur la fiche (un « compte invité » est un membre actif dont le code est actif ; un seul retrait en attente à la fois).
Découvertes : dans Équipe › Membres, la fiche d'un membre devenu propriétaire propose encore de changer son statut, que le serveur refuse ; l'écran pourrait le dire avant le clic. `pnpm owner:create` ne compte pas les propriétaires : voulu (dernier recours), à écrire dans le runbook d'exploitation.
Candidats à suppression : aucun.
Vérifié : suites ciblées vertes en local (contrats, API unitaire, intégration `owners`, `security-settings`, `invitation-links`, `team-members`, balayages, RLS et rôle de service) ; `pnpm check` avant la PR.
