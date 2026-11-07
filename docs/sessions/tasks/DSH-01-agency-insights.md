# DSH-01 Le Dashboard de l'agence : insights des ventes
Statut : in_progress (lot A fait, PR #631, ADR 0078 acceptée le 07/11 ; lot B à venir : ADR 0080, migration 0135)
Phase : pilotage (ADR 0078)
Dépend de : registre des ventes (ADR 0050)
Branche : claude/project-thread-195o3s
Propriétaire : Extension (écran) ; Bilan (route, données)

## Objectif
Le propriétaire et un manager actif voient l'activité et les ventes de toute l'agence, puis d'une créatrice, en graphiques lus dans le registre des ventes, pour décider de la stratégie de vente.

## Contexte à lire
ADR 0078, ADR 0050, ADR 0043 § 7.

## À faire
- [x] Lot A : route `GET /v1/dashboard/agency` (période, créatrice facultative, période d'avant), domaine pur testé, lecteur sous RLS, test d'intégration.
- [x] Lot A : écran « Toute l'agence » (chiffres, chiffre d'affaires par jour, deux anneaux, classement des vendeurs, créatrices côte à côte, heures, fans) et même écran filtré sur une créatrice au-dessus de son bloc agent.
- [ ] Lot B : abonnés (instantané de `/v1/stats/daily`), ADR 0080 et migration 0135 réservées.

## Critères d'acceptation
- Aucun appel à Reveal depuis l'écran ; aucun chiffre inventé ; opérateur, chatteur et créatrice reçoivent 403.
- Captures Nuit/Jour, PC/téléphone validées par Charles.

## Hors périmètre
« À traiter » (PR #627), la liste des créatrices.

## Notes de session
2026-11-06 : lot A codé, captures v2 sur données inventées (pile 2).
