# DSH-06 Le Dashboard de l'agence ne conclut pas sur trop peu de ventes
Statut : review
Phase : pilotage
Dépend de : DSH-01 (ADR 0078), DSH-04 (ADR 0146)
Branche : claude/project-thread-v704ot
Propriétaire : fil « Compléter le Dashboard de l'agence » ; relecteur Design (apps/web)

## Objectif
Appliquer l'ADR 0092 § 5 : une phrase d'insight (créneau qui rapporte, concentration des gros fans) ne s'écrit que si la période compte assez de ventes et assez de jours de registre. Sinon l'écran écrit « Pas encore assez de ventes pour conclure. » et garde tous les chiffres.

## Contexte à lire
ADR 0092 § 5 (les seuils y sont), ADR 0146 (jours lus, `registerSince`, `span.today`).

## À faire
- [x] `canConclude` et `registerDays` dans `period.ts` : ventes de la période, jours couverts par le registre entre le premier jour de la période et le dernier (borné à aujourd'hui).
- [x] « Quand ça vend » : la phrase du créneau et du pic laisse la place à la phrase d'attente ; la carte reste.
- [x] « Les fans » : la phrase de concentration laisse la place à la phrase d'attente ; la jauge, sa part, les payeurs et les nouveaux payeurs restent.
- [x] Tests : unitaires des deux fonctions, écran avec peu de ventes et avec un registre trop jeune.
- [ ] Captures Nuit/Jour, PC/téléphone, données inventées ; avis Design puis « ok captures » de Charles.
- [ ] OK de Design sur le dernier commit.

## Critères d'acceptation
- Aucune conclusion sous l'un des deux seuils ; tous les chiffres restent.
- Un jour seul ne conclut jamais.
- Les seuils ne sont écrits qu'à un endroit du code.

## Hors périmètre
La liste des remboursements (§ 4, DSH-07) et les objectifs mensuels (§ 6, DSH-08).
