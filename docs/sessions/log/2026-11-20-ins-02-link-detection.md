# 2026-11-20 — INS-02 lot b (détection des liens chez le service de redirection, sans écran) — in progress

Fait : `listLinks()` sur le port du connecteur de liens et sur `FakeLinkStats` ; contrats `DetectedLinkSchema` (strict : aucun chiffre, rien d'un visiteur) et `LinkProposalSchema` ; `redirect-links/domain/detection.ts` (`placementHint`, `linkProposals`) avec ses tests. Aucune table, route ni appel au service.
Reste : clé dans Réglages et adaptateur officiel (lot c, Sécurité), écran « Détecter ses liens » (lot d, Design), référence du service sur le lien et totaux par heure (lot e).
Découvertes : l'hôte du service écrit dans l'adaptateur (ADR 0120 § 3) fera entrer son nom dans le dépôt public, alors que l'ADR le nomme seulement « service de redirection » : à trancher avec Sécurité et Charles avant le lot c.
