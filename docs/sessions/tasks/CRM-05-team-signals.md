# CRM-05 Ventes hors shift, écarts d'assignation et performance des chatteurs

Statut : in progress (ADR 0050, fiches acceptées par Charles le 02/11/2026 ; complétée par l'ADR 0092 § 1, acceptée le 12/11/2026 : PR 1 de 3)
Phase : API CRM (ADR 0050)
Dépend de : CRM-01, CRM-03 pour les ventes en attente
Branche : task/crm-05-team-signals
Propriétaire : Équipe (ADR 0092 § 1), relectures Bilan (PR 1), Agent (PR 2), recette design (PR 3)

## Objectif

L'agence repère une vente hors shift, un écart d'assignation entre Reveal et Impera, et un chatteur qui envoie beaucoup mais vend peu.

## Contexte à lire

ADR 0025 (marge d'accès), ADR 0043 § 7, ADR 0049, ADR 0050 §§ 5 et 10.

## À faire

- [ ] Signaux : vente hors shift et marge ; `ppv`, `tip` ou `paid_message` sans chatteur.
- [ ] Écart entre `modelIds` de `/v1/chatters` et les assignations d’Impera, signalé sans rien modifier.
- [ ] Vue manager et propriétaire : PPV envoyés et achetés, messages, par chatteur et par jour ; `null` affiché « pas encore compté », jamais zéro.
- [ ] Pas de classement nominatif montré aux chatteurs (ADR 0043 § 7).

### La valeur d'un chatteur (ADR 0092 § 1, 12/11/2026)

Pour chaque chatteur et chaque créatrice, par jour puis sur la période du Dashboard : ventes comptées (registre), heures en poste (shifts finis), chiffre par heure en poste, PPV envoyés et achetés, taux d'achat, messages envoyés. Le même calcul pour l'agent sur ses heures « IA seule ». Trois PR à la suite (plan validé par le coordinateur le 12/11) :

- [x] PR 1 : ADR 0092 et sa ligne d'index ; photo par chatteur `platform_chatter_daily_stats` (migration 0170, RLS forcée, lecture du propriétaire et du manager actif de la créatrice, jamais d'un chatteur) remplie par le job horaire `connector.read_daily_stats` (un appel de plus à `/v1/stats/chatters/daily`, compté, sous la même réserve) ; lecture `chatterStatsOf` exportée par `connectors`.
- [ ] PR 2 : le calcul et les routes. « Qui a vendu » gagne, pour chaque vendeur, heures en poste, chiffre par heure, PPV envoyés et achetés, taux d'achat et messages ; une route donne la vue d'un membre par jour et par créatrice ; l'agent est compté sur ses heures « IA seule » (mode et créneaux d'aujourd'hui : pas d'historique du mode). Tests : un chatteur ne voit jamais les chiffres d'un autre, et rien ne change la paie.
- [ ] PR 3 : les écrans (captures Nuit/Jour, PC/téléphone) : chaque ligne de « Qui a vendu » ouvre la vue du membre ; la fiche du membre en donne le résumé (chiffre, chiffre par heure, taux d'achat, rapports en retard sur la quinzaine).

## Critères d'acceptation

- Un chatteur ne voit jamais les chiffres d'un autre (test).
- Aucun de ces chiffres ne change la paie (test).

## Hors périmètre

Tout malus calculé.

## Notes de session
