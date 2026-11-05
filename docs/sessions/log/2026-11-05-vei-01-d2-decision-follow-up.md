# 2026-11-05 — VEI-01 lot d2 : son geste dans l'agenda suit l'idée
Fait :
- l'acceptation ou le refus d'une suggestion met en file `creator_tasks.suggestion_decided` dans sa transaction (une fois par suggestion, `day` = jour de la tâche dans son fuseau) ;
- le job est câblé chez `trends` (`followDecision`) : acceptée, la demande de contenu naît par `requestFromIdea` (index de `content-drops`, rôle admin, origine `idea`, sous l'identifiant de l'idée) et s'inscrit dans `content_ideas.request_id` ; refusée, l'idée passe à `declined` ;
- `trends` peut dépendre de `content-drops` (eslint).

Pas fait : d3 (dépôt reçu → `deposited`).

Décisions :
- un job annoncé par l'agenda plutôt qu'un événement `creator_suggestion_decided` dans `domain_events` : aucun module ne lit l'outbox pour réagir, et le job s'écrit dans la même transaction que son geste, sans migration. La 0111 réservée n'a pas servi ;
- la demande prend l'identifiant de l'idée, pour qu'un rejeu n'en écrive pas une deuxième.

Découvertes : aucune.

Vérifié :
- `pnpm check` ;
- intégration `trend-ideas` (acceptée, refusée, rejouée, suggestion sans idée), `creator-agenda`, `creator-reminders`, `content-drops`.
