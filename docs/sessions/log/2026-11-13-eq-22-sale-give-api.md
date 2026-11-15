# 2026-11-13 — EQ-22 / ADR 0101, 0101a : donner ou partager une vente, l'API — in progress
Fait : ADR 0101 (avec l'amendement « partager ») dans `docs/adr/` et l'index ; contrats (`give`, `SaleGiven`, `MySaleGiven`, `excludeReason`, `recipients`, `pay_sale_recipient_conflict`) ; migration 0175 (registre par membre et par part, décision avec receveur, part, raison d'un écart et vente gardée telle que le registre l'a, déclencheurs des parts) ; domaine de la paie (`recipientsOf`, `recipientPartOf`, attribution `shared`) ; magasins (décision, clôture, « Mes ventes lues ») ; textes français ; glossaire (« Vente donnée », « Part d'une vente partagée », « Raison d'un écart ») ; fiche EQ-22.
Pas fait : les écrans (0101b) et « Qui a vendu » sur cette attribution (CRM-05 PR 2).
Décisions : aucune nouvelle ADR ; migration 0175 attribuée par le coordinateur ; « Donner à… » caché à l'écran jusqu'à 0101b, « Écarter » envoie « autre raison » en attendant le choix.
Découvertes : Commissions › Performance montre les paliers à un manager alors que le moteur ne lui en donne jamais (`tierBonus` nul pour un manager) : à corriger dans une PR à part.
Candidats à suppression : aucun.
Vérifié : unitaires de la paie (invariant des parts de 10 % à 90 % sur des nets impairs), intégration de la paie (33 fichiers, dont `payroll-sale-gifts`), tests de l'écran de paie, sur un Postgres local.
