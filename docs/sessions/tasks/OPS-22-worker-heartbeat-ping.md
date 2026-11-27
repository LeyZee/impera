# OPS-22 Un worker arrêté se voit de l'extérieur
Statut : review
Phase : exploitation
Dépend de : OPS-19 (mise en service), `docs/runbooks/deploy.md` § 1.6
Branche : claude/project-thread-v4lgkv (branche imposée par la session)

## Objectif
Quand le worker s'arrête, se fige ou perd la base, le propriétaire en est prévenu par un service hors du serveur, puisque toutes les alertes de l'application passent par le worker et la base.

## Contexte à lire
Audit de robustesse du 27/11 (hors dépôt), `apps/api/src/worker-runner.ts` (battement), `apps/api/src/readiness.ts`, `docs/architecture/operations.md` § Santé, `docs/runbooks/deploy.md` § 1.6.

## À faire
- [x] `WORKER_HEARTBEAT_URL` dans `config.ts` : facultative, URL sans identifiants, `https` en production.
- [x] `heartbeat-ping.ts` : un `GET` au plus une fois par minute, borné à 10 s, jamais d'exception, jamais l'adresse au journal.
- [x] Le worker l'appelle après chaque battement écrit en base, jamais après un battement raté ; un runner arrêté sur une erreur ne bat plus, donc ne ping plus.
- [x] `deploy.md` § 1.6 (création du contrôle, vérification), tableau des variables, `operations.md`, `.env.example`.

## Critères d'acceptation
- Tests unitaires : rythme d'une minute, échec et refus sans exception ni adresse au journal, nouvel essai une minute après un échec ; configuration refusée sans URL, avec identifiants, en `http` en production.
- Sans la variable, rien ne sort du worker.

## Hors périmètre
La création du compte chez le service de surveillance (Charles) ; l'exposition de `/ready` par nginx ; le rappel quotidien du jeton Reveal (après #1052).

## Notes de session
- Un battement par minute vers le service, pas toutes les 30 s comme en base : assez pour une période de 5 minutes, et poli envers un service gratuit.

## Résultat
Code et docs faits. Reste pour Charles : créer le contrôle et coller son adresse dans Coolify sur `worker`.
