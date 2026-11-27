# 2026-11-21 — INS-02 lot c3 (« Détecter ses liens » côté serveur) — in progress

Fait : `connectors.detectedLinks` (lit la clé gardée, appelle l'adaptateur, ne garde rien) ; route `POST /v1/creators/:creatorId/redirect-links/detect` du propriétaire seul, qui rend les propositions sans rien écrire ; la clé du service de redirection est rescellée par `pnpm ops:reencrypt-credentials` et comptée par `pnpm ops:check-keys`. Tests d'intégration : détection (propositions, lien déjà connu, refus du manager, du chatteur et de la créatrice sans appel sortant, clé absente, panne du service), rechiffrement de la clé.
Reste : l'écran (champ de la clé dans Réglages, « Détecter ses liens » dans l'onglet Liens) avec Design et captures validées, puis les totaux par heure et les robots (lot e).
Découvertes : aucune.
