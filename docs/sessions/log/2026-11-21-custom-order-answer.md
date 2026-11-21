# 2026-11-21 — Demande sur mesure : la réponse de la créatrice, côté serveur (ADR 0159 § A, lot 1) — done
Fait : migration 0247 (prix, acompte, qui a répondu et quand, contrôles) ; contrats `CustomOrderView`, `DecideCustomOrderBody`, `AdvanceCustomOrderBody`, transitions `CUSTOM_ORDER_MOVES`, calcul `customDepositMinor` ; magasin `agency-store` sous la RLS de la créatrice (`withTenantMember`) ; routes de lecture, de réponse et d'étapes ; test d'intégration des droits (propriétaire, manager en lecture, chatteur et compte de la créatrice refusés, autre créatrice) et des étapes ; ADR 0159, glossaire (« Commandes en cours »), README.
Pas fait : les écrans (ligne dépliée d'« À traiter », « Commandes en cours ») avec captures et avis Design ; la carte « Demande d'un fan » dans l'espace de la modèle (lecture par son compte, migration et avis Sécurité) ; l'annonce du prix et la demande d'acompte par l'IA (fil Agent).
Décisions : lecture par le propriétaire et un manager actif qui la suit, réponse et étapes par le propriétaire seul (Charles, 21/11) ; l'audit ne garde jamais un prix ; aucun accès par le rôle de service.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : intégration `custom-order-answers`, `creator-account-rls`, `tenant-isolation`, balayages d'authentification et d'origine ; dérive du schéma alignée ; `pnpm check`.
