# OPS-22 Un worker arrêté se voit de l'extérieur, et le compte de l'IA se corrige
Statut : done
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
- [x] Compte de l'IA (même audit) : la première synchro du popup dit qu'elle épingle le compte Reveal de l'IA et qu'il faut le « bot » ; le refus « autre membre » dit comment s'en sortir ; `pnpm ops:release-ai-account --list | --account <id>` oublie la session et le membre épinglé d'un compte (audité), runbook `session-expired.md` étape 6.

## Critères d'acceptation
- Tests unitaires : rythme d'une minute, échec et refus sans exception ni adresse au journal, nouvel essai une minute après un échec ; configuration refusée sans URL, avec identifiants, en `http` en production.
- Sans la variable, rien ne sort du worker.
- Test d'intégration : la libération vide la session, le membre et l'état, garde le reste du compte, écrit `connector.session_released`, rejouable ; un compte inconnu rend `false`. Test du popup : la phrase de la première synchro.

## Hors périmètre
La création du compte chez le service de surveillance (Charles) ; l'exposition de `/ready` par nginx ; un bouton dans l'application pour changer le compte de l'IA (nouvel écran, après l'ouverture si Charles le veut) ; la comparaison du membre épinglé avec les chatteurs du relevé des ventes (identifiants jamais vus en vrai) ; le rappel quotidien du jeton Reveal (après #1052).

## Notes de session
- Un battement par minute vers le service, pas toutes les 30 s comme en base : assez pour une période de 5 minutes, et poli envers un service gratuit.

- Plafond du rôle de service : `root` 53 → 55 (ADR 0087 § 5) : la commande d'exploitation liste tous les comptes de plateforme et oublie la session de l'un, à travers les créatrices, comme les autres commandes de `ops.ts`.

## Résultat
Code et docs faits. Reste pour Charles : créer le contrôle et coller son adresse dans Coolify sur `worker` ; refaire la première synchro avec le « bot » après la libération de son compte.
