# CRM-04 Ventes en direct : alertes Telegram, bilan et revenus de la créatrice

Statut : todo (ADR 0050, fiches acceptées par Charles le 02/11/2026)
Phase : API CRM (ADR 0050)
Dépend de : CRM-01
Branche : task/crm-04-sales-everywhere
Propriétaire proposé : Telegram pour les alertes, Bilan pour les chiffres, Extension pour les écrans

## Objectif

Chaque vente lue déclenche son alerte, et le bilan comme l'espace de la créatrice montrent les mêmes chiffres que Reveal.

## Contexte à lire

ADR 0020, ADR 0042 (§§ 6 et 7), ADR 0050 § 8, P3-07, CR-04.

## À faire

- [ ] `sale_detected` publié depuis le flux de ventes, idempotent, avec le chatteur ou l'agent, sans nom de pack.
- [ ] Bilan : CA, part de l'agence et part de la modèle, par créatrice et par chatteur.
- [ ] Espace de la créatrice : `modelRevenue` fait foi sur un compte basculé ; un écart avec le pourcentage réglé se signale au propriétaire, sans changer de montant.

## Critères d'acceptation

- Une vente rejouée ne donne qu'une alerte (test).
- La somme du bilan égale `/v1/stats/daily` sur un mois (test contre FakeReveal).

## Hors périmètre

Le nom du pack et l'entonnoir par bundle (capture).

## Notes de session
