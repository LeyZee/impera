# CRM-05 Ventes hors shift, écarts d'assignation et performance des chatteurs

Statut : todo (ADR 0050, fiches acceptées par Charles le 02/11/2026)
Phase : API CRM (ADR 0050)
Dépend de : CRM-01, CRM-03 pour les ventes en attente
Branche : task/crm-05-team-signals
Propriétaire proposé : Équipe, Extension pour les écrans

## Objectif

L'agence repère une vente hors shift, un écart d'assignation entre Reveal et Impera, et un chatteur qui envoie beaucoup mais vend peu.

## Contexte à lire

ADR 0025 (marge d'accès), ADR 0043 § 7, ADR 0049, ADR 0050 §§ 5 et 10.

## À faire

- [ ] Signaux : vente hors shift et marge ; `ppv`, `tip` ou `paid_message` sans chatteur.
- [ ] Écart entre `modelIds` de `/v1/chatters` et les assignations d’Impera, signalé sans rien modifier.
- [ ] Vue manager et propriétaire : PPV envoyés et achetés, messages, par chatteur et par jour ; `null` affiché « pas encore compté », jamais zéro.
- [ ] Pas de classement nominatif montré aux chatteurs (ADR 0043 § 7).

## Critères d'acceptation

- Un chatteur ne voit jamais les chiffres d'un autre (test).
- Aucun de ces chiffres ne change la paie (test).

## Hors périmètre

Tout malus calculé.

## Notes de session
