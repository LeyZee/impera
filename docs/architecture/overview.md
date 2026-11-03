# Architecture : vue d'ensemble

Dernière revue : 2026-10-16.

## En une phrase

Un **monolithe modulaire** TypeScript, organisé en modules métier à frontières vérifiées, dont le cœur (conversations, fans, persona, agent) ne connaît aucune plateforme : Reveal, OnlyFans, Instagram et notre future plateforme sont des **adaptateurs** derrière des ports. Le journal d'événements par conversation est la source de vérité ; les files de jobs sur Postgres garantissent un seul écrivain par conversation.

## Les quatre couches

```
┌───────────────────────────────────────────────────────────────────┐
│ Clients : apps/web (dashboard, inbox copilote, playground, PWA)    │
│           apps/extension (découverte, capture de session, relais)  │
└───────────────▲───────────────────────────────▲───────────────────┘
                │ HTTP/SSE (contracts)          │ protocole extension
┌───────────────┴───────────────────────────────┴───────────────────┐
│ apps/api : Fastify (HTTP) + Graphile Worker (jobs), même code      │
│   modules/ connectors · conversations · fans · persona · agent     │
│            media · supervision · sales (P6) · scripts (P6)         │
│   composition-root.ts : câblage manuel des modules                 │
└──────▲────────────────────▲──────────────────────▲────────────────┘
       │ packages/db        │ packages/llm          │ packages/contracts
┌──────┴────────┐  ┌────────┴─────────┐   ┌─────────┴───────────────┐
│ Postgres      │  │ Fournisseurs LLM │   │ Zod : la vérité partagée │
│ + RLS         │  │ via LlmGateway   │   │ entre api, web, extension│
└───────────────┘  └──────────────────┘   └──────────────────────────┘
       ▲
       │ PlatformConnector (port)
┌──────┴────────────────────────────────────────────────────────────┐
│ Plateformes : Reveal (API privée via session capturée),            │
│   FakeReveal (tests), plus tard OnlyFans, Instagram, Impera       │
└───────────────────────────────────────────────────────────────────┘
```

## Principes (et leur ADR)

1. **Le cœur ignore les plateformes.** Il manipule `platform_account`, `fan`, `conversation`, `message`. Ce qui est spécifique à Reveal vit dans `modules/connectors/infra/reveal/`. (ADR 0003, 0008)
2. **Frontières explicites.** Un module expose `index.ts` ; ESLint interdit le reste. `domain/` est pur. (ADR 0002)
3. **Journal d'événements.** `conversation_events` est append-only et complet ; les tables d'état sont des projections. (ADR 0007)
4. **Un seul écrivain par conversation.** File Graphile Worker `queue_name = conv:<id>`, debounce par `job_key`. (ADR 0006)
5. **Les règles vivent dans le code.** Prix, cooldowns, droits d'envoi, dégoûts, identité : politique et gardes en TypeScript, testées. Les prompts reçoivent des décisions. (ADR 0009, 0012)
6. **Trois rôles LLM** (sens, cerveau, voix) derrière une passerelle unique, fournisseur configurable par rôle. (ADR 0009)
7. **Idempotence** : identifiants plateforme uniques, clés d'idempotence, jobs rejouables. (ADR 0007, 0011)
8. **Tenant partout** : `creator_id` sur chaque table, RLS. (ADR 0005)
9. **Persona = donnée versionnée.** (ADR 0010)
10. **Sécurité par défaut** : rien d'exposé, secrets chiffrés, entrées non fiables délimitées. (`conventions/security.md`)

## Ce qui est volontairement absent

- Microservices, bus de messages externe (Kafka, Redis) : inutiles à 100 conversations. Les ports existent pour les ajouter si un jour il le faut.
- Framework de DI, ORM « magique », GraphQL : complexité sans gain ici.
- pgvector, RAG : seulement quand la mémoire structurée + résumé ne suffira plus, mesuré.
- Multi-agence : une créatrice, un opérateur. Le modèle de données le permet (tenant), l'UI ne le fait pas encore.

## Lire ensuite

- `modules.md` : les règles de frontières et la liste des modules.
- `data-model.md` : entités, journal, projections.
- `message-flow.md` : le chemin d'un message, les modes copilote/auto.
- `connectors.md` : le port, Reveal, FakeReveal, options A/B/C.
- `ai-engine.md` : sens/cerveau/voix, passerelle, fournisseurs, politique, gardes.
- `own-platform.md` : ce que le cœur ne doit pas supposer pour notre future plateforme.
- `operations.md`, `threat-model.md`.
