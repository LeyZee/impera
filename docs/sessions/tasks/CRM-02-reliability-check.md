# CRM-02 Prouver la fiabilité sur une quinzaine passée

Statut : in-progress (ADR 0050, fiches acceptées par Charles le 02/11/2026)
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

03/11/2026, Bilan, PR 1 (mécanisme, sans les données de Charles, demandé par la coordination) :
- `POST /v1/settings/sales-feeds/:plateforme/check` : registre face à `/v1/stats/daily` et à l'export, au centime, par modèle et par jour ; registre face à `/v1/stats/chatters/daily` par membre ; verdict et notes (bot non relié à l'agent, remboursement sans vente, modèle inconnu). Lecture seule, export gardé nulle part. Détail dans le README de `connectors`.
- Le membre « bot » : le rapport montre ses ventes sous son propre `chatterId`, son drapeau `isBot` et son lien ; une note le signale tant qu'il n'est pas relié à l'agent.
- Relectures Extension et Équipe : une ligne de quarantaine libérée n'est plus comptée deux fois ; écart d'un membre sur le net seul ; jamais `match` avec une modèle de l'export inconnue ou des jours avant le registre ; jours en cours refusés ; `registerReadAt` dans le rapport.
- Reste : adapter `EXPORT_HEADERS` au vrai export (Charles) ; vérifier la devise des lignes face à celle des statistiques ; le net par chatteur et par modèle exposé par l'index de `connectors` pour Équipe ; commissions sur `netAmount` face à la chaîne de l'ADR 0023 (Équipe, module paie) ; l'écran dans Réglages › Ventes (Extension) ; lancer la vérification sur une quinzaine passée avec la clé de Charles et lui présenter le rapport.

