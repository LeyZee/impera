# 2026-11-03 — ADR 0054 et décisions de la fiche CRM-04 — done
Fait : l'ADR 0054 (gains de la créatrice : les chiffres de Reveal dès que son modèle est relié, sans attendre la bascule), acceptée par Charles le 03/11 à 09h45 (« ok 0054 ») sur les mots exacts de la phrase de son § 1, qui remplace celle de l'ADR 0042 § 6 sur la source des ventes ; l'ADR 0042 et l'index le disent. La fiche CRM-04 inscrit les six recommandations acceptées par Charles à 09h32 (« ok recos ») : montant TTC et minimum des alertes Telegram, pas d'alerte en direct pour un remboursement, notification de la créatrice avec sa part, sa part `modelRevenue` dès le modèle relié, écart au pourcentage au-delà d'un centime par vente, alerte « important » après la bascule.
Décisions : aucune de plus que celles de Charles.
Découvertes : la vue `creator_sales` du lot d n'a pas `platform_fan_id`, alors que la créatrice voit le fan connu par sa fiche : Bilan l'a tranché le même jour (jointure à la fiche du fan, seulement `fan_id`), écrit dans la fiche (lot d) avec son test. La migration du lot d prend 0081 a priori, 0080 allant au lot b de Telegram.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓.
