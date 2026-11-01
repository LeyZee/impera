# apps/api

Le backend : un serveur Fastify (HTTP, SSE) et un worker Graphile (jobs), construits par le même `composition-root.ts`. Toute la logique métier vit dans `src/modules/<module>/` (voir `docs/architecture/modules.md` et le README de chaque module).

```
src/
├── index.ts              démarre l'API (et le worker si NIRVANA_INLINE_WORKER=1)
├── worker.ts             démarre le worker seul (prod)
├── worker-runner.ts      Graphile Worker : tâches, heartbeat, arrêt borné
├── server.ts             Fastify : plugins, erreurs, /health, /ready, /v1
├── config.ts             process.env validé par Zod
├── validation-messages.ts  messages de Zod en français (API et worker)
├── logger.ts             pino partagé (redaction), pont vers les logs Graphile
├── jobs.ts               file de jobs typée et defineTask (payload validé)
├── crontab.ts            jobs périodiques Graphile (poll, reconcile, purge)
├── readiness.ts          vérifications de /ready
├── shutdown.ts           SIGTERM : arrêt ordonné, code 0
├── composition-root.ts   câblage manuel des modules
├── modules/              connectors, conversations, fans, persona, agent, media, supervision, sales, scripts
├── scripts/              commandes ops et persona (pnpm ops:*, persona:*)
└── __tests__/            tests transverses (frontières, e2e légers)
test/
├── fake-reveal/          serveur mock Reveal à scénarios (phase 1)
└── e2e/                  bout en bout (API + worker + FakeConnector)
```

Règles : routes sans logique métier ; chaque accès base dans `withTenant` ; chaque transition d'état écrit son événement ; aucun SDK LLM importé ici (passer par `@nirvana/llm`).
