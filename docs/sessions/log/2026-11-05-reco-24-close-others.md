# 2026-11-05 — Reco 24 de la recette : « Fermer les autres » garde l'appareil de confiance courant

Fait :
- `revokeSignIns` (`packages/db`) prend `keepTrustedDevice` : l'appareil de confiance de ce navigateur reste, les autres partent ;
- `POST /v1/auth/sessions/close-others` lit cet appareil dans le cookie du navigateur (`trustedDeviceIdentifier`, `auth.ts`, aussi utilisé par la connexion) ;
- la phrase de confirmation de Réglages › Sécurité dit « tes autres appareils de confiance » ;
- `data-model.md` le dit.

Décisions :
- l'identifiant vient du cookie signé ; la suppression reste bornée au compte de la session, un identifiant d'un autre compte ne protège rien.

Découvertes :
- aucune.

Vérifié :
- intégration `security-settings` (le téléphone part, l'ordinateur qui ferme garde le sien) ; `pnpm check`.
