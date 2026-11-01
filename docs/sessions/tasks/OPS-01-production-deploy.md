# OPS-01 Mise en production : images, limiteur partagé, runbook
Statut : done
Phase : exploitation (ADR 0005, ADR 0027, `docs/architecture/operations.md`)
Dépend de : rien
Branche : claude/project-thread-guzxdb (une branche de push pour la session, une PR par lot)

## Objectif
Pouvoir déployer Nirvana sur le VPS Hetzner avec Coolify, de façon répétable et réversible, le jour où Charles le décide.

## Contexte
Au 27/10, rien n'était déployable : aucun Dockerfile, un `dist/` de l'API qui ne démarrait pas sous Node, un limiteur de débit en mémoire et aucune procédure de mise en service. Les décisions sont dans l'ADR 0027.

## À faire
- [x] Lot 1 : build de l'API qui démarre (tsup, paquets du dépôt embarqués), `apps/api/Dockerfile` (API, worker, scripts d'exploitation), `apps/web/Dockerfile` (nginx, `/v1` vers l'API), `docker-compose.prod.yml`, job CI `images` qui construit et démarre la pile.
- [x] Lot 2 : magasin Postgres pour `@fastify/rate-limit` (table de compteurs, migration, purge des fenêtres expirées), tests d'intégration à deux instances de l'API.
- [x] Lot 3 : `docs/runbooks/deploy.md` : première mise en service (Neon, rôles, Coolify, domaine), variables depuis `.env.example`, migrations, sauvegardes, retour arrière, coupe-circuit.

## Critères d'acceptation
- La CI construit les deux images et démarre la pile : `/ready` vert (base, migrations, worker), le dashboard servi, `/v1` joint l'API à travers nginx.
- Deux instances de l'API partagent leurs compteurs : la limite ne double pas.
- Le runbook suffit à quelqu'un qui n'a jamais vu le projet pour le mettre en service puis revenir à la version précédente.

## Hors périmètre
Le déploiement lui-même (action de Charles), Langfuse auto-hébergé, Sentry.

## Notes de session
