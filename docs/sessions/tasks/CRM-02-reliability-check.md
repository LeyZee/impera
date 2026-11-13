# CRM-02 Prouver la fiabilité sur une quinzaine passée

Statut : in-progress (ADR 0050, fiches acceptées par Charles le 02/11/2026)
Phase : API CRM (ADR 0050)
Dépend de : CRM-01 ; l'export du dashboard est facultatif depuis CRM-14 (ADR 0050 § 8 amendé le 11/11/2026 : le dashboard de Reveal n'en offre pas)
Branche : task/crm-02-reliability-check
Propriétaire proposé : Bilan et Équipe

## Objectif

Charles voit, sur une quinzaine passée, si les chiffres de l'API concordent et ce que la bascule changerait pour chaque chatteur, avant qu'aucun compte ne bascule.

## Contexte à lire

ADR 0050 § 8, ADR 0023 (§ Une seule source), ADR 0032.

## À faire

- [ ] Comparaison : somme de `netAmount` face à `/v1/stats/daily`, et à l'export du dashboard quand il y en a un (facultatif, CRM-14), au centime, par modèle et par jour.
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

03/11/2026, Extension, PR 2 (l'écran) :
- Réglages › Ventes, bloc « Vérification de fiabilité » sous les liens, tant que la clé est lue (`connected`) : les deux dernières quinzaines terminées (1er–15, 16–fin du mois, heure de Paris) ou d'autres jours, refusés avant l'appel s'ils comptent aujourd'hui ou plus de 31 jours ; l'export choisi sur l'appareil, lu en UTF-8 puis en Windows-1252 (CSV d'un tableur français), 2 000 000 caractères au plus, envoyé en texte et gardé nulle part.
- Le rapport : verdict (ambre pour un écart ou une comparaison incomplète, jamais rouge), jours de la plateforme et `registerReadAt`, notes en phrases, totaux des trois sources avec l'écart au registre, jours en écart détaillés par figure, tous les jours repliés, puis chaque membre de l'équipe (nom chez la plateforme, lien Impera, net et nombre de ventes, l'écart sur le net seul).
- Reste : inchangé pour Bilan et Équipe (vrai export, devise, commissions) ; lancer la vérification avec la clé de Charles.

03/11/2026, Extension, PR 3 (le dernier rapport réaffiché) :
- Au retour sur Réglages › Ventes, le dernier rapport gardé (`GET …/check`, #426) s'affiche sous le formulaire, avec sa date (« Vérifié il y a 3 h ») et l'avance du registre sur la vérification (« registre lu 2 min avant ») ; une vérification lancée depuis le remplace.
- Ce que le rapport dit de la bascule vient du serveur (`clean`, relu après chaque vérification) : une ligne discrète quand il pourra la porter, ambre quand tout concorde mais pas sur une quinzaine entière, ou qu'une note reste à régler. Les « Autres jours » rappellent que la bascule demandera une quinzaine entière.
- La note d’un bot relié à un membre suit le lien que le rapport a vu (`chatters[].link`), pas celui posé depuis ; sur un rapport gardé, elle ne nomme pas le membre, que le rapport ne garde pas.
