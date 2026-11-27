# Fondations techniques

Langage, découpage en modules, base de données, file de jobs, IA derrière une passerelle, argent et identifiants.

Cette page ne décide rien : elle range. La règle est dans chaque décision liée ; le titre d’une décision est sa règle en une phrase. Quand une décision a été changée en partie par une plus récente, c’est indiqué, et la plus récente gagne sur le point qu’elle change.

## Lire d’abord

- [`docs/architecture/overview.md`](../architecture/overview.md)
- [`docs/architecture/modules.md`](../architecture/modules.md)
- [`docs/conventions/coding.md`](../conventions/coding.md)

## Décisions, de la plus ancienne à la plus récente

- **0001** · [TypeScript, monorepo pnpm + Turborepo](../adr/0001-typescript-monorepo.md) — acceptée
- **0002** · [Monolithe modulaire, frontières vérifiées par ESLint](../adr/0002-modular-monolith-boundaries.md) — acceptée
  - précisée ou complétée par : [0047](../adr/0047-split-payroll-wiring-and-web-folders.md), [0051](../adr/0051-pure-entry-for-shared-module-rules.md)
- **0003** · [Cœur agnostique de la plateforme (y compris notre future plateforme sans abonnement)](../adr/0003-platform-agnostic-core.md) — acceptée
  - précisée ou complétée par : [0057](../adr/0057-instagram-and-telegram-publishing-connectors.md)
- **0004** · [Fastify plutôt que NestJS](../adr/0004-fastify-not-nest.md) — acceptée
- **0005** · [Postgres + Drizzle + RLS par `creator_id`](../adr/0005-postgres-drizzle-rls.md) — acceptée ; en partie changée par [Hébergement : un VPS Hostinger avec Coolify, la base chez Supabase, les coffres de stockage chez d'autres fournisseurs](../adr/0152-hosting-hostinger-vps-and-supabase.md)
  - précisée ou complétée par : [0087](../adr/0087-service-role-between-app-and-owner.md)
- **0006** · [Graphile Worker, une file série par conversation](../adr/0006-graphile-worker-per-conversation-queues.md) — acceptée
  - précisée ou complétée par : [0110](../adr/0110-agent-and-reveal-automations.md), [0135](../adr/0135-time-waster-scarce-attention.md)
- **0007** · [Journal d'événements de conversation comme source de vérité](../adr/0007-conversation-event-log.md) — acceptée
- **0009** · [Passerelle LLM unique, trois rôles, règles métier dans le code](../adr/0009-llm-gateway-three-roles.md) — acceptée
  - précisée ou complétée par : [0075](../adr/0075-recette-sandbox-simulated-reveal-and-ai.md), [0100](../adr/0100-ai-writes-scripts-for-the-vault.md), [0172](../adr/0172-fan-simule.md)
- **0010** · [Persona = donnée versionnée (YAML + schéma Zod), pas du code](../adr/0010-persona-as-versioned-data.md) — acceptée
  - précisée ou complétée par : [0060](../adr/0060-trend-watch-and-content-ideas.md), [0079](../adr/0079-persona-sheet-follows-desirali.md), [0090](../adr/0090-custom-order-handoff-and-objection-replies.md), [0100](../adr/0100-ai-writes-scripts-for-the-vault.md), [0122](../adr/0122-instagram-comments-answered-in-her-voice.md), [0172](../adr/0172-fan-simule.md)
- **0011** · [Argent en unités mineures entières ; identifiants UUID v7 typés](../adr/0011-money-and-ids.md) — acceptée
- **0013** · [Code en anglais, documentation, UI et persona en français](../adr/0013-code-english-docs-french.md) — acceptée
- **0014** · [Politique d'hygiène du dépôt](../adr/0014-repo-hygiene-policy.md) — acceptée
- **0047** · [Ranger le code qui a grossi : la paie en quatre modules, l'argent calculé par le seul serveur, l'assemblage par module, le dashboard par domaine](../adr/0047-split-payroll-wiring-and-web-folders.md) — acceptée
  - précisée ou complétée par : [0051](../adr/0051-pure-entry-for-shared-module-rules.md)
- **0051** · [Un second point d'entrée, pur, pour les règles qu'un module prête aux domaines qui en dépendent](../adr/0051-pure-entry-for-shared-module-rules.md) — acceptée
- **0087** · [Un rôle de service entre le rôle applicatif et le rôle propriétaire de la base](../adr/0087-service-role-between-app-and-owner.md) — acceptée
  - précisée ou complétée par : [0152](../adr/0152-hosting-hostinger-vps-and-supabase.md)

Retour au [sommaire des règles](README.md).
