# 2026-11-11 — CRM-14 Vérification de fiabilité sur deux sources — done
Fait : ADR 0050 § 8 amendé en place (le registre face à `/v1/stats/daily` au centime, et face à l'export du dashboard quand il y en a un ; carte « Deux sources » et « ok phrases 0050 », 18 h 24). Le verdict `match` ne demande plus d'export : statistiques lues, aucun écart, rien sans comparaison ; un export joint reste comparé (`mismatch` à la moindre différence) ; sans statistiques, `incomplete`. Textes du web (verdict, note des statistiques, panneau, raison `check_not_clean`) et docs de référence (glossaire, README de `connectors`, recette, fiches CRM-02 et CRM-03) alignés.
Pas fait : rien de la fiche.
Décisions : aucune nouvelle ; l'amendement de l'ADR 0050 § 8 est celui que Charles a accepté.
Découvertes : l'ADR 0084 (étape 4, « avec l'export du dashboard Reveal de ces jours-là ») et les mentions de l'historique au-delà de 31 jours par l'export (ADR 0050 conséquences, ADR 0069, CRM-07) supposent un export qui n'existe pas : à amender avec l'accord de Charles. `isCleanMatch`, le corps Zod de la route et la garde de la paie n'exigeaient pas l'export eux-mêmes.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓ (api 1984, web 1971) ; tests d’intégration non lancés ici, Docker absent (deux attentes de `sales-feed-check.integration.test.ts` passées de `incomplete` à `match`).
