# Module `creator-decisions` : « À décider », les questions posées à la créatrice (ADR 0164)

Le code pose une **décision** à une créatrice sur un de ses contenus : une question, une ligne de contexte, deux ou trois réponses. Elle y répond une fois, sur son téléphone, ou la met de côté (« Plus tard ») ; le propriétaire peut répondre à sa place. Le module garde la réponse et la rend à qui a demandé : il ne sait pas ce qu'une réponse déclenche.

**Peut dépendre de.** Aucun autre module.

**État.** Lot a : contrat (`packages/contracts`, `creator-decisions.ts`), table et RLS (`creator_decisions`), routes, porte `asking`. Aucun code ne demande encore : rien ne s'affiche. La notification, les légendes proposées et « D'autres idées » viennent au lot b (fiche INS-05).

## Pour le code qui demande (`asking`)

- `ask(creatorId, decision)` : écrit la question, une fois par sujet (`kind` + `subject`) ; rend `false` quand elle avait déjà été posée. Les réponses doivent s'accorder à la forme : un texte sur chaque rangée, aucun sur un bouton.
- `withdraw(creatorId, kind, subject)` : retire une question encore ouverte (le contenu n'existe plus).
- `read(creatorId, kind, subject, now)` : où elle en est (`open`, `answered` avec la réponse, `withdrawn`, `ended` passé sa fin), ou `null` si elle n'a jamais été posée.

Tout passe par `withTenantJob(…, 'creator_decisions', …)`, une créatrice à la fois : jamais le rôle de service.

## Routes

- `GET /v1/creator-space/decisions` : ce qui l'attend maintenant, ce qui finit le plus tôt en premier.
- `POST /v1/creator-space/decisions/:id/answer` : sa réponse ; la même renvoyée ne change rien, une autre est refusée (409).
- `POST /v1/creator-space/decisions/:id/later` : de côté deux heures, jamais au-delà de sa fin.
- `GET /v1/creators/:creatorId/decisions` et `POST …/:id/answer` : le propriétaire seul, à sa place, avec une ligne au journal d'audit.
