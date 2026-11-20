# CR-16 La semaine de la créatrice : deux jours de tournage, une livraison le dimanche, un agenda que le code remplit

Statut : in_progress (lot 1 en PR ; ADR 0140, acceptée par Charles le 16/11/2026 ; lancée par Charles le 20/11/2026, « ça peut être cool de le faire »)
Phase : espaces (ADR 0140, ADR 0042 § 3 à § 5)
Dépend de : CR-05 (agenda), CR-06 (dépôts et demandes), SC-02 (scripts demandés par la cadence)
Branche : claude/project-thread-b1a26e

## Objectif

Elle se concentre sur la création : sa semaine arrive préparée, en trois ou quatre lignes, qu'elle accepte d'un geste. Le code calcule ce qu'il y a à tourner sur ses vrais chiffres, le propriétaire le relit et le valide.

## Contexte à lire

`docs/adr/0140-creator-week-shoot-days-and-delivery.md`, ADR 0042 (§ 3 à § 5, § 8), ADR 0055 (§ 4, § 5), ADR 0056 (§ 2), `apps/api/src/modules/creator-tasks/README.md`, `apps/api/src/modules/creator-week/README.md`.

## À faire

### Lot 1 (serveur)
- [x] Contrats `creator-week.ts` : besoins, plan, vues du propriétaire et d'elle, refus.
- [x] Migration 0235 : `creator_weeks` (brouillon, validation par le propriétaire seul), `creator_shoot_items` (lignes d'un jour de tournage, sa coche seule), `creator_suggestions.week_role`.
- [x] Règles pures : besoins (scripts, feed, stories), charge plafonnée et report, jours de tournage, échéance, semaine à calculer.
- [x] Job `creator_week.plan` chaque heure : le brouillon de la semaine d'après dès le dimanche 18 h dans son fuseau, rafraîchi jusqu'à la validation, rejouable.
- [x] Validation par le propriétaire : ses « Jour de tournage » et « Livrer ma semaine » dans son agenda, sous des identifiants rejouables.
- [x] Chez elle : lire sa semaine, « Accepter ma semaine », cocher une ligne (la tâche du jour suit), sa livraison comptée par ses dépôts.

### Lot 2 (écrans, captures avant fusion)
- [ ] Chez elle, dans l'Agenda existant : sa semaine (jours de tournage et leurs lignes à cocher, « Livrer ma semaine » avec « Déposer »), « Accepter ma semaine ».
- [ ] Chez le propriétaire, dans Créatrices › Agenda : relire, déplacer un jour ou une ligne, retirer, valider ; ce qui passe à la semaine d'après.

### Lot 3
- [ ] Réglages par créatrice (nombre de jours, capacité, durées, échéance) ; le rappel du matin d'un jour de tournage ; la veille et le jour de l'échéance ; le propriétaire prévenu le dimanche soir qu'une semaine attend ; la livraison en retard en ambre côté agence.
- [ ] La Relance (plan des Mass DM, ADR 0137) et les idées validées (au plus 2) dans les besoins ; les publications faites pour elle en lecture seule ; les mesures (acceptation, livraison à l'heure, stock en jours).
- [ ] Les fiches rédigées par l'IA (avec le topo, CR-07), le code gardant ses fiches de secours.

## Critères d'acceptation

- Tests : semaine calculée seulement après le dimanche 18 h et rejouée sans doublon ; jamais plus lourde que ses jours ; validation par le seul propriétaire, rejouable, un autre plan refusé ; rien chez elle avant la validation ; coche refusée sur un jour non accepté ; tâche du jour cochée avec sa dernière ligne ; livraison comptée par les dépôts de la semaine.

## Hors périmètre

Les lives (rien d'automatique, § 15) ; tout envoi réel.

## Notes de session
