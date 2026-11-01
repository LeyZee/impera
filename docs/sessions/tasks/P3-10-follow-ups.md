# P3-10 Relances : un fan n'est jamais laissé sans réponse

Statut : done (ID validé par Charles le 27/10 à 18h37)
Phase : 3
Dépend de : P0-05 (conversations), P3-02, `PROPOSED-method-gaps.md`
Branche : task/P3-10-follow-ups

## Objectif

Faire vivre les relances que la fiche persona décrit déjà (`follow_ups`, `strategies.post_offer.delay_days`) : relancer un fan resté silencieux, relancer une offre refusée au plus deux fois, et toujours dire au revoir.

## Constat (Bilan, 27/10)

Le job `conversation.follow_up` est déclaré dans les contrats, mais aucune tâche ne le traite dans la composition root, et les événements `follow_up_scheduled` et `follow_up_cancelled` n'ont aucun émetteur : tout le circuit manque.

## Partage

- Bilan (conversations, worker) : programmer une relance après le dernier message du fan, l'annuler quand il écrit ou qu'un humain reprend la main, faire passer la tâche par les mêmes verrous que `conversation.respond`, émettre les deux événements.
- Agent : décider si la relance part (limites du fan, ventes gelées, détresse, nombre de relances de vente déjà faites), et l'écrire par le même chemin qu'une réponse : cerveau, voix, gardes, brouillon à valider.

## À faire

- [x] Bilan : planification, annulation, tâche, événements, tests d'intégration (`follow-ups.integration.test.ts`).
- [x] Agent : port `FollowUpPlan` exporté et branché dans la composition root (sans lui, rien n'est programmé), `ComposeInput.followUp` lu par l'adaptateur, `retryAt` pour ses heures calmes ; règle pure `followUpDecision` (aucune relance à un fan à ne plus contacter ou en détresse, délais de `follow_ups.delays_hours`) et son écriture en brouillon. Les relances de vente (au plus deux, `post_offer.delay_days`) attendent P6-01 : d'ici là, une relance ne vend jamais.
- [x] Le playground montre la relance avec `advance` (`/avance 12h` puis `/relance`).

## Critères d'acceptation

- Une relance n'est jamais envoyée : elle devient un brouillon, comme toute réponse.
- `pnpm check`, `pnpm test`, `pnpm test:integration` verts.

## Hors périmètre

Les relances de masse, les vocaux.

## Notes de session

27/10 (Bilan) : contrat convenu avec le fil agent. Ancre = dernier message du fan ; programmation à l'envoi vérifié d'un message d'elle ; annulation paresseuse (le job relit sous verrou et écrit `follow_up_cancelled`) ; brouillon depuis `idle` ; `held` `no_reply` avec `retryAt` (24 h au plus) reprogramme la même étape ; `handoff` et `guard_blocked` passent la main, `llm_unavailable` et `budget_reached` n'écrivent rien. Un brouillon de relance refusé ne programme pas l'étape suivante.

27/10 (Agent) : part moteur. `followUpDecision` (`apps/api/src/modules/agent/domain/follow-up.ts`) : à ne plus contacter, ou ventes gelées pour détresse → `no_reply` sans alerte ; étape au-delà du plan → `no_reply` ; de 23 h à 8 h 59 chez elle → `no_reply` `follow_up_quiet_hours` avec `retryAt` à 9 h. Ses limites illisibles ou inconnues → rien n'est écrit (jamais un message à un fan peut-être stoppé). L'écriture ne passe pas par le cerveau (rien de lui à lire) : brief fixé par le code, rien de payant, aucune allusion sexuelle, toutes les gardes dont `explicit_before_age` quel que soit son âge ; une garde bloquante passe la main. `follow_ups.type: custom` donne son `text` à la voix comme esprit de ses relances. `startFollowUpPlan` (index agent) lit les délais de la persona (aucun si désactivées) ; la composition root le branche seulement à côté du composer de l'agent.

Reste (P6-01) : relances de vente après un refus (au plus deux, `post_offer.delay_days`), qui demandent l'historique des scripts Reveal.
