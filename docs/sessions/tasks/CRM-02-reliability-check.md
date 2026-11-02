# CRM-02 Prouver la fiabilité sur une quinzaine passée

Statut : todo (ADR 0050, fiches acceptées par Charles le 02/11/2026)
Phase : API CRM (ADR 0050)
Dépend de : CRM-01, l'export du dashboard fourni par Charles hors dépôt
Branche : task/crm-02-reliability-check
Propriétaire proposé : Bilan et Équipe

## Objectif

Charles voit, sur une quinzaine passée, si les chiffres de l'API concordent et ce que la bascule changerait pour chaque chatteur, avant qu'aucun compte ne bascule.

## Contexte à lire

ADR 0050 § 8, ADR 0023 (§ Une seule source), ADR 0032.

## À faire

- [ ] Comparaison : somme de `netAmount` face à `/v1/stats/daily` et à l'export du dashboard, au centime, par modèle et par jour.
- [ ] Commissions de chaque chatteur sur `netAmount` face à la chaîne de l'ADR 0023, avec l'écart et sa cause (frais de paiement, TVA).
- [ ] Vérifier que le membre « bot » remonte sous son propre `chatterId`, et ce que `memberId` permet de relier.
- [ ] Rapport hors dépôt, aucune donnée réelle dans git, présenté à Charles.

## Critères d'acceptation

- Un écart de somme entre les sources est expliqué, sinon la bascule reste fermée.
- Cette fiche ne modifie aucun montant de paie.

## Hors périmètre

La bascule elle-même (CRM-03).

## Notes de session
