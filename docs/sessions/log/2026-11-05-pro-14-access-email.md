# 2026-11-05 · PRO-14 d : corriger l'e-mail d'un accès pas encore utilisé

- Fiche : recette du 05/11, PRO-14 ; ADR 0071 § 3.
- Fait :
  - `POST /v1/creators/:creatorId/invitation-link` (`invitation`) avec un autre e-mail corrige celui de son compte tant que son mot de passe n'est pas choisi : l'ancien lien est révoqué, un nouveau est créé, l'audit `creator_account.email` nomme l'auteur et la créatrice, jamais les adresses ;
  - une fois son mot de passe choisi, 409 `creator_account_conflict` comme avant ; un e-mail d'un autre compte, 409 `account_email_conflict` ;
  - Créatrices › Accès montre son e-mail dans un champ tant qu'elle ne s'est pas connectée ; corrigé, le bouton devient « Corriger et créer son lien » et une ligne dit que l'ancien lien cessera de marcher.
- Tests : `invitation-links.integration.test.ts`, `AccessSection.test.tsx`.
- Découvertes : aucune.
