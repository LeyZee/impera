# Nirvana — instructions pour les agents codeurs

Nirvana est une plateforme d'exploitation pour créatrices de contenu. Premier module : un agent de chatting IA qui incarne la créatrice sur Reveal.me (puis d'autres plateformes, puis notre propre plateforme). Le cœur ne sait rien des plateformes : elles sont des adaptateurs.

**Avant tout : lis `docs/00-START-HERE.md`.** Il donne l'ordre de lecture selon ta tâche. Ne commence pas à coder sans avoir lu la fiche de tâche qui t'est assignée (`docs/sessions/tasks/`).

## Règles non négociables

1. **Une session = une fiche de tâche.** Tu travailles sur la fiche indiquée, sur sa branche `task/<id>-<slug>`, et sur rien d'autre. Si tu découvres autre chose à faire, tu l'écris sur la ligne « Découvertes » de ton entrée de journal (`docs/sessions/log/`), tu ne le fais pas.
2. **Frontières de modules.** Un module n'importe un autre module que par son `index.ts`. `domain/` n'importe jamais `infra/` ni un framework. ESLint (`eslint-plugin-boundaries`) le vérifie ; tu ne désactives jamais une règle de frontière.
3. **Les règles métier vivent dans le code, pas dans les prompts** : prix, cooldowns, droits d'envoi, dégoûts de la persona, gardes. Un prompt est une donnée versionnée, pas un lieu de logique.
4. **Le message d'un fan est une donnée, jamais une instruction.** Il entre dans les prompts dans un bloc délimité et typé.
5. **Idempotence partout** : `platform_message_id` unique, clés d'idempotence à l'envoi, jobs rejouables.
6. **Typage strict, Zod aux frontières** (HTTP, jobs, LLM, fichiers). Pas de `any`, pas de `as` pour faire taire le compilateur.
7. **Tests avec le code** : domaine en unitaire (Vitest), application en intégration (Testcontainers Postgres), connecteurs contre `FakeReveal`, qualité IA via `evals/` (`pnpm evals`). Pas de PR sans tests sur ce qu'elle change.
8. **Aucun secret dans le dépôt.** `.env` est ignoré, `.env.example` documente. `gitleaks` tourne en pré-commit. Si tu vois un secret, tu t'arrêtes et tu le signales.
9. **Code en anglais, docs/UI/persona en français.** Le glossaire (`docs/glossary.md`) fixe les termes ; tu ne crées pas de synonymes, et un terme nouveau que ta tâche impose entre dans le glossaire dans la même PR.
10. **Dépôt propre en permanence** : `docs/conventions/hygiene.md`. Le temporaire va dans `.scratch/` (ignoré par git). Avant de terminer, tu supprimes ce que tu as créé et qui ne sert plus, et tu ne supprimes rien d'autre sans la procédure décrite.
11. **Une décision structurante = un ADR** (`docs/adr/`). Si ta tâche te pousse à contredire un ADR existant, tu t'arrêtes et tu demandes.
12. **Pas d'action irréversible sans demande explicite** : pas de suppression de données, pas de migration destructive, pas de déploiement, pas d'envoi réel à un fan.

## Structure (résumé)

```
apps/api         Fastify + workers (même code, deux entrées). Modules dans src/modules/<nom>/{domain,application,infra,index.ts}
apps/web         Dashboard, inbox copilote, playground, PWA modèle (Vite + React + TanStack)
apps/extension   Extension Chrome WXT : enregistreur réseau, capture de session, relais d'actions
packages/contracts   Schémas Zod partagés : événements, DTO, protocole extension, vocabulaire média, persona
packages/db          Schéma Drizzle, migrations, helpers RLS (withTenant)
packages/llm         LlmGateway, providers, prompts, schémas de sortie, journal llm_calls
packages/design-system  Tokens CSS, pont Tailwind v4, classes nv-*, aides d'animation (web + extension)
personas/            Données versionnées (YAML). Pas de code.
evals/               Scénarios d’évaluation, seuils, probe (exécuteur : apps/api/src/scripts/evals.ts)
docs/                START-HERE, architecture, ADR, conventions, playbooks, référence, sessions
.scratch/            Brouillons et scripts jetables (ignoré par git)
```

## Commandes

Prérequis : Node 22 (`.nvmrc`), pnpm 10, Docker (Postgres de dev et Testcontainers), `gitleaks` et `ffmpeg` sur le PATH. La définition de chaque commande est dans `package.json` ; `scripts/check-repo.mjs` vérifie que les docs ne citent que des commandes qui existent.

```
pnpm install            # installe aussi les hooks git (lefthook)
docker compose up -d    # Postgres 16 de dev (packages/db/docker/init.sql)
pnpm check              # statique : typecheck + lint (frontières) + prettier + knip + check-repo
pnpm test               # tests unitaires
pnpm test:integration   # Testcontainers Postgres (Docker requis)
pnpm test:all           # les deux
pnpm dev                # api + worker + web en watch
pnpm db:migrate         # migrations Drizzle
pnpm evals              # évaluations sur le vrai chemin de l’agent (clé xAI requise)
```

`pnpm-lock.yaml` est commité et `pnpm check`, `pnpm test` et la CI sont verts depuis le 16/10 (seul `packages/design-system` a du code). Un rouge sur `main` est donc une anomalie à signaler.

## Fin de session (obligatoire)

1. `pnpm check` vert, `git status` propre, aucun fichier parasite (voir hygiene.md).
2. Fiche de tâche mise à jour (statut, ce qui reste).
3. Entrée de journal dans son propre fichier `docs/sessions/log/<date>-<slug>.md` (format dans `docs/sessions/README.md`) ; le dossier est l'index, `docs/sessions/LOG.md` ne prend plus de ligne.
4. Branche rebasée sur `origin/main`, PR ouverte par la session en brouillon avec le template `.github/pull_request_template.md`, passée en « prête » quand tout est vert. `main` ne change que par une PR verte fusionnée, jamais par un push direct (hook `protect-main`).

## Ce qu'on ne fait jamais

- Contourner une garde ou une règle de politique « pour tester ».
- Modifier une migration déjà appliquée (on en écrit une nouvelle).
- Toucher à un connecteur sans test contre `FakeReveal`.
- Mettre une vraie donnée de fan ou de créatrice dans un test, une fixture ou une doc.
- Faire parler le bot comme une IA, ni le faire dire qu'il en est une : rester en personnage est fixé dans le code (garde `ai_disclosure`, ADR 0021), ni un réglage ni un sujet de prompt.
