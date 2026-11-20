# CR-16 La semaine de la créatrice : deux jours de tournage, une livraison le dimanche, un agenda que le code remplit

Statut : in_progress (lots 1 et 2 en PR #921, captures de recette à faire ; ADR 0140, acceptée par Charles le 16/11/2026 ; lancée par Charles le 20/11/2026, « ça peut être cool de le faire »)
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
- [x] Migration 0237 : `creator_weeks` (brouillon, validation par le propriétaire seul), `creator_shoot_items` (lignes d'un jour de tournage, sa coche seule), `creator_suggestions.week_role`.
- [x] Règles pures : besoins (scripts, feed, stories), charge plafonnée et report, jours de tournage, échéance, semaine à calculer.
- [x] Job `creator_week.plan` chaque heure : le brouillon de la semaine d'après dès le dimanche 18 h dans son fuseau, rafraîchi jusqu'à la validation, rejouable.
- [x] Validation par le propriétaire : ses « Jour de tournage » et « Livrer ma semaine » dans son agenda, sous des identifiants rejouables.
- [x] Chez elle : lire sa semaine, « Accepter ma semaine », cocher une ligne (la tâche du jour suit), sa livraison comptée par ses dépôts.

### Lot 2 (écrans, captures avant fusion)
- [x] Chez elle, dans l'Agenda existant : sa semaine (jours de tournage et leurs lignes à cocher, « Livrer ma semaine » avec « Déposer »), « Accepter ma semaine ».
- [x] Chez le propriétaire, dans Créatrices › Agenda : relire, déplacer un jour ou une ligne, retirer, valider ; ce qui passe à la semaine d'après.

- [ ] Captures de recette (Nuit/Jour, PC/téléphone, données inventées) et avis Design avant fusion.
- [x] À notre tour de fusion (train 4, 20/11) : main ramené, migration renumérotée en 0237 (après 0236 de la grille sur mesure), plafond du rôle de service relevé : `modules/creator-week` 2 (lecture et écriture du brouillon par le job du dimanche, qui passe sur toutes les créatrices), `wiring` +3 (stock, jours de tournage et disponibilités lus par le job pour une créatrice dont il n'a pas la session) ; total 264 → 269. Ces accès sont ceux que Sécurité a relus sur d85d2dd.

### Lot 2 bis (retours de Charles du 20/11)
- [x] Son rythme : 3 séances boudoir (Mass DM et photos « cadeaux » sur leur fiche, un média de Mass DM demandé par séance), une vidéo du jour, une story par jour, un script toutes les deux semaines (avenant à l'ADR 0140).
- [x] Sa carte relue au téléphone : le prochain tournage en grand, les autres jours repliés, une couleur par type de contenu qu'elle change elle-même (gardée sur son appareil), le début de chaque fiche visible.
- [x] Sa journée (second avenant) : « Ma journée » au-dessus de sa semaine, l'essentiel du jour d'abord (story Reveal, vidéo du jour, story qui mène à Reveal), le bonus Instagram et Telegram ensuite ; une coche par post, gardée dans `creator_day_ticks` (migration 0238), le jour même ou le lendemain ; jamais de publication à sa place.
- [x] Captures de « Ma journée » validées par Charles avant fusion (lot ma-journee-2, 20/11, sans retouche).

### Lot 3
- [ ] Réglages par créatrice (nombre de jours, capacité, durées, échéance) ; le rappel du matin d'un jour de tournage ; la veille et le jour de l'échéance ; le propriétaire prévenu le dimanche soir qu'une semaine attend ; la livraison en retard en ambre côté agence.
- [ ] La Relance (plan des Mass DM, ADR 0137) et les idées validées (au plus 2) dans les besoins ; les publications faites pour elle en lecture seule ; les mesures (acceptation, livraison à l'heure, stock en jours).
- [ ] Les fiches rédigées par l'IA (avec le topo, CR-07), le code gardant ses fiches de secours.

## Critères d'acceptation

- Tests : semaine calculée seulement après le dimanche 18 h et rejouée sans doublon ; jamais plus lourde que ses jours ; validation par le seul propriétaire, rejouable, un autre plan refusé ; rien chez elle avant la validation ; coche refusée sur un jour non accepté ; tâche du jour cochée avec sa dernière ligne ; livraison comptée par les dépôts de la semaine.

## Hors périmètre

Les lives (rien d'automatique, § 15) ; tout envoi réel.

## Notes de session

- 20/11, relecture Sécurité sur d85d2dd : ses arrivées se lisent dans son compte (`withCreatorAccount`), plus avec le rôle de service ; les lignes d'un jour de tournage et les cadres de sa semaine ne s'écrivent que par le propriétaire (politiques et `suggestWeek`) ; la validation enregistre la semaine d'abord, puis écrit son agenda : rejouée, elle complète ; un autre plan est refusé.
