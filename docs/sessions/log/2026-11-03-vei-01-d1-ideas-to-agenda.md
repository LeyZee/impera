# 2026-11-03 — VEI-01 lot d1 : « Idées du jour » et la suggestion de l'agenda
Fait :
- routes « Idées du jour » : liste du jour, valider (correction facultative, relue par les gardes du code), refuser (motif), pour le propriétaire et un manager actif ;
- une idée validée devient une suggestion de son agenda par `suggestShoot` (index de `creator-tasks`), à la première place libre de ses dispos (`firstPlacement`) ;
- fiche de tournage (`shoot_brief`) sur la suggestion et la tâche, recopiée à l'acceptation ;
- migration 0110, avec l’origine `idea` des demandes et `content_ideas.request_id` pour d2 ; `trends` peut dépendre de `creator-tasks` (eslint).

Pas fait : d2 (acceptation → demande de contenu, refus → `declined`) et d3 (dépôt reçu → `deposited`). L'écran de la fiche est chez Chantier 7, celui d'« Idées du jour » chez Extension.

Décisions :
- découpage d1, d2 et d3, et événements plutôt qu'écritures croisées : accord de Chantier 7, de Médias et de la coordination ;
- la créatrice ne lit jamais la raison ni le signal d'une idée ;
- la suggestion porte l'identifiant de l'idée, pour que la validation soit rejouable.

Découvertes :
- la fiche de tournage de l'ADR 0042 § 4 n'était prise par aucune tâche ;
- le titre d'une idée (120) dépassait celui de l'agenda (80).

Vérifié :
- `pnpm check` ;
- tests unitaires de `creator-tasks` et `trends` ;
- intégration `trend-ideas` (7), `creator-agenda` et `trends`.
