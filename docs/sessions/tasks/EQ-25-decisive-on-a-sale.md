# EQ-25 « J'ai été décisif sur une vente »
Statut : in_review (trous béants n° 15, validé par Charles le 21/11/2026 : « J'ai été décisif sur une vente qui arrive dans Ventes en attente du manager »)
Phase : équipe (ADR 0101 §§ 18 à 22)
Dépend de : EQ-22 (donner une vente)
Branche : claude/project-thread-cohhca-sale-claim

## Objectif
Le chatteur qui a convaincu un fan dont la vente est allée à un autre le dit depuis Commissions, sur un de ses shifts, sans voir aucune vente. Le signalement arrive chez le propriétaire et les managers, qui retrouvent la vente dans « Donner une vente » et répondent.

## À faire
- [x] ADR 0101 amendée (§§ 18 à 22, remplace la règle 7).
- [x] Tables `pay_sale_claims` et `pay_sale_claim_answers` en ajout seul (FORCE RLS, `refuse_pay_change`, lecture seule pour le rôle de service), migration 0272 (numéro donné par Bilan au train du 26/11).
- [x] `pay.endedShifts` du module `scheduling` ; magasin `sale-claim-store` ; quatre routes ; journal sans la note.
- [x] Écrans : panneau « J'ai été décisif sur une vente » dans Commissions (choix du shift, note, suivi, retrait) ; panneau « Signalements de chatteurs » au-dessus de « Ventes en attente » (« Voir les ventes de ce shift », « Réglé », « Pas retenu »).
- [x] Tests : intégration (droits, idempotence, bornes, quinzaine clôturée, isolation), unitaires (textes), écrans.
- [ ] Captures validées par Design ; OK de Sécurité sur les droits et les routes ; numéro de migration par Bilan.

## Reste
La notification sur le téléphone (sans la note) viendra avec les notifications de la paie (§ 21).
