# 2026-11-06 — DSH-01 Dashboard de l'agence, lot A — review
Fait : ADR 0078 (proposée) ; contrat `AgencyInsightsSchema` ; domaine `agencyInsights` (périodes jour, 7 jours, 30 jours, 3 mois et la période d'avant, euros et dollars séparés, types de vente, vendeurs, créatrices, heures, fans) ; lecteur sous `withTenantMember` ; route `GET /v1/dashboard/agency` (propriétaire, manager actif) ; écran « Toute l'agence » et filtre par créatrice ; jetons `--nv-series-1..5` et `--nv-series-other` validés Nuit et Jour.
Pas fait : lot B (abonnés), qui attend un numéro d'ADR et de migration.
Décisions : les couleurs suivent l'entité (créatrice par son rang dans l'agence, famille de vendeur fixe), au-delà de cinq créatrices tout se replie dans « Autres créatrices » ; légendes et valeurs toujours écrites (palette Jour en avertissement de contraste).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, tests web ✓, tests unitaires API ✓ ; test d'intégration écrit, non joué ici (pas de Docker), joué par la CI ; captures v2 (10 écrans) sur la pile 2.
