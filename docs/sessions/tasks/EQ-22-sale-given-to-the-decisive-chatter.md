# EQ-22 Donner ou partager une vente avec le chatteur qui a été décisif

Statut : in_progress (ADR 0101 acceptée par « ok 0101 » le 13/11/2026, amendement « partager » par « ok phrases 0101 » le même jour)
Phase : API CRM (ADR 0050)
Dépend de : CRM-03 (ventes en attente et décision du valideur), CRM-05 PR 1
Branche : task/eq-22-sale-give
Propriétaire : Équipe, relecture Bilan (migration 0175)

## Objectif

Le valideur donne une vente, entière ou partagée, au membre en poste qui a convaincu le fan, et la paie, les relevés et « Mes ventes lues » le suivent.

## Contexte à lire

ADR 0101, ADR 0050 § 5, ADR 0025, ADR 0043 § 7, ADR 0032, ADR 0072 ; `apps/api/src/modules/payroll/domain/sales.ts`, `infra/sale-decision-store.ts`, `infra/sale-signal-store.ts`.

## À faire

En deux PR (plan du 13/11) :

- [x] 0101a, l'API : contrats (`give`, `SaleGiven`, `MySaleGiven`, `excludeReason`, `recipients`, `pay_sale_recipient_conflict`) ; migration 0175 (registre d'une clôture par membre et par part, décision avec receveur, part, raison d'un écart et vente gardée telle que le registre l'a ; déclencheurs des parts) ; domaine (`recipientsOf`, `recipientPartOf`, attribution `shared`, remboursements aux mêmes parts) ; magasins (décision, clôture, « Mes ventes lues ») ; l'écran de paie garde ses gestes (« Donner à… » caché jusqu'à son écran, « Écarter » envoie « autre raison »).
- [x] 0101b, les écrans : « Donner à… » avec « Toute la vente » ou « Partager » (50/50 en un geste, pas de 10 % sur une barre), le choix « l'IA a été décisive » sur « Écarter », le panneau « Donner une vente » (les ventes d'un jour, d'un membre ou de l'IA, où un autre membre était en poste ; `GET …/sales-to-give?day=`), « Donnée à … », « Reçue de … », « Partagée avec … : 40 % pour toi » dans « Mes ventes lues » et sur la carte du valideur, le nombre de ventes données par valideur et par mois pour le propriétaire (§ 17, `GET …/sale-gifts`).
- [ ] 0101b, captures Nuit/Jour, PC/téléphone, vues par Charles avant fusion (lot `ventes-donnees-0101b-2` prêt le 13/11 après les retouches de Design, nouvel avis demandé).

## Critères d'acceptation

- La somme des parts redonne le net au centime, de 10 % à 90 %, ventes et remboursements (test d'invariant).
- Un don ne va qu'à un membre en poste à l'instant de la vente, jamais à son auteur ni au valideur ; une vente de l'agent ne se partage pas (tests d'intégration).
- Une vente partagée s'inscrit au registre en deux lignes, et la base refuse une part seule ou des parts qui ne font pas le tout (test).
- Un chatteur ne lit de l'autre que son prénom et la note, jamais ses autres ventes (ADR 0043 § 7).

## Hors périmètre

« Qui a vendu » lu sur cette attribution (CRM-05 PR 2), l'export comptable.

## Notes de session

- 13/11, Équipe, 0101a : la décision d'un don garde la vente du registre (devise, net, instant), pour que son auteur la lise une fois sortie de son relevé sans lire le registre (la portée `self` ne le lit pas). Les ventes de l'agent ne sont pas listées dans « Ventes en attente » tant qu'aucune décision ne les touche : la liste à part vient avec 0101b.
- 13/11, Équipe, 0101b : un manager retrouve une vente que personne n'a signalée par son jour (panneau « Donner une vente » sous « Ventes en attente »), parce qu'une vente payée à son auteur n'apparaît dans les ventes en attente que signalée ; la liste ne garde que les ventes où le lecteur a quelqu'un à nommer, jamais les siennes. Le compteur du propriétaire compte les dons en vigueur écrits dans le mois (une décision retirée ou changée depuis ne compte plus). Découverte (relecture de Bilan sur #731) : la contrainte différée du registre ne relie pas `share_bp` ni `member_id` au don en vigueur ; la clôture le garantit et les tests le couvrent, une petite migration pourrait le faire tenir par la base plus tard.
