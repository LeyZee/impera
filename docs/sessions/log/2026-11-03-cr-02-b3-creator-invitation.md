# 2026-11-03 — CR-02 lot b3 : l'invitation de la créatrice — done
Fait : migration 0089 (`invitation_links.user_id`, `member_id` facultatif, contrainte « l'un ou l'autre », lien vivant unique par compte) ; `POST /v1/creators/:creatorId/invitation-link` (propriétaire, connexion récente) qui crée son compte `creator` la première fois et un lien de 72 h ; `inspect` et `redeem` pour les deux sortes de liens ; aperçu sans pays et page Bienvenue « Ton espace créatrice » ; tests d'intégration (4 nouveaux) et test web ; glossaire, fiche CR-02.
Décisions : le mécanisme d'EQ-10 réutilisé tel quel (même table, même page, même rachat), le lien visant le compte plutôt qu'un membre ; un seul compte par créatrice, son e-mail fixé à la première invitation ; un e-mail déjà pris refusé plutôt que de rattacher un compte existant.
Pas fait : bouton « Inviter » et état du lien sur sa fiche (lot c).
Découvertes : aucune.
