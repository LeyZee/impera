# Modules et frontières

Dernière revue : 2026-10-16.

## Anatomie d'un module

```
apps/api/src/modules/<name>/
├── README.md          rôle, dépendances autorisées, tables possédées
├── index.ts           porte d'entrée publique : createXModule(deps), types, commandes
├── domain/            types, règles pures, machines d'état, erreurs. Zéro I/O.
├── application/       cas d'usage : commandes, requêtes, handlers de jobs
├── infra/             repositories Drizzle, routes Fastify, tâches Graphile, clients externes
└── __tests__/         ou *.test.ts à côté du code
```

- `domain/` importe : `packages/contracts`, d'autres fichiers de `domain/`. Rien d'autre. Pas de `node:` non plus sauf `node:crypto` pour les UUID.
- `application/` importe : `domain/`, les **ports** (interfaces) définis dans `domain/ports.ts`, `packages/contracts`, l'`index.ts` des modules autorisés par le graphe ci-dessous (et seulement ceux-là : ESLint génère la règle depuis `MODULE_DEPENDENCIES`).
- `infra/` importe : tout ce qui précède, `packages/db`, `packages/llm`, Fastify, Graphile, clients HTTP.
- Un autre module n'importe que `modules/<name>` (son `index.ts`). Jamais `modules/<name>/infra/...`.

## Graphe de dépendances autorisé

```
connectors ──▶ conversations (événements entrants : IngestMessage, SessionStateChanged, SaleDetected)
conversations ──▶ fans, persona, agent, media
agent ──▶ fans, persona, media, packages/llm
supervision ──▶ conversations, fans
media ──▶ packages/llm
sales ──▶ conversations, media            (phase 6, non créé)
scripts ──▶ sales, media, conversations   (phase 6, non créé)
playground ──▶ agent, packages/llm        (écran Entraîner, P3-06)
fans, persona, providers, telegram, team, backups, scheduling, alerts, payroll ──▶ (feuilles)
```

Ce graphe est **sans cycle**, et `import-x/no-cycle` le vérifie. Deux inversions le rendent possible :

- **Envoi** : `conversations` ne dépend pas de `connectors`. Il définit le port `OutboundSender` (`sendText`, `sendMedia`, `verifySent`) dans `conversations/domain/ports.ts` ; `connectors` l'implémente et le composition root l'injecte dans `createConversationsModule(deps)`.
- **Supervision** : `conversations` ne dépend pas de `supervision`. `supervision` apprend qu'un draft existe par l'événement `draft_created` (outbox), et agit sur les conversations par leur `index.ts` (`approveDraft`, `takeover`, …).

Un cycle est une erreur de conception, pas un cas à autoriser. Si `fans` a besoin de `conversations`, c'est que la responsabilité est au mauvais endroit, ou qu'il faut un événement.

## Communication entre modules

1. **Appel direct** via l'`index.ts` du module cible, pour les lectures et les commandes synchrones simples.
2. **Événements de domaine** pour tout ce qui doit être découplé ou différé : un module écrit un événement dans `conversation_events` (ou `domain_events` pour le hors-conversation) **dans la même transaction** que son changement d'état (outbox). Un job Graphile les distribue aux abonnés. C'est ainsi que `supervision` apprend qu'un draft existe, que `fans` apprend qu'un fait est confirmé, que `sales` apprend qu'un envoi payant a eu lieu.
3. **Jobs** pour le travail asynchrone (`conversation.respond`, `conversation.record_facts`, `media.describe`, `fans.refresh_summary`, `conversation.follow_up`, `conversation.reopen`, `connector.poll`, `connector.reconcile`). Nom = `<module>.<verbe>`.

## Propriété des tables

Chaque table a exactement un module propriétaire (voir le README de chaque module). Un module lit les tables des autres **uniquement** via leur `index.ts` (requêtes exposées), jamais par SQL direct. Les vues SQL du tableau de bord (`apps/api/src/modules/supervision/infra/views/`) sont l'exception documentée : lecture seule, agrégats.

## Application des règles

- `eslint.config.js` : la constante `MODULE_DEPENDENCIES` reproduit le graphe ci-dessus et **génère** les politiques de la règle `boundaries/dependencies` (eslint-plugin-boundaries 7, `default: disallow`) : un module n'importe que l'`index.ts` des modules listés, jamais leurs dossiers internes ; `domain/` n'importe que son propre `domain/` et `@nirvana/contracts`, sans I/O (ni `node:*` sauf `node:crypto`, ni Drizzle, Fastify, Graphile, `pg`, `undici`) ; les SDK LLM sont interdits hors `packages/llm`. `import-x/no-cycle` interdit les cycles. Éléments : `module` (un dossier `apps/api/src/modules/<nom>`, ses couches `domain`, `application`, `infra`, `index.ts` distinguées par leur chemin interne), `api-root`, `api-scripts`, `api-tests`, `api-test`, `package`, `web`, `extension`, `evals`. Le test `apps/api/src/__tests__/boundaries.test.ts` prouve chaque protection sur des fixtures. Une violation = erreur de lint = CI rouge.
- Modifier le graphe = modifier `MODULE_DEPENDENCIES` **et** ce document **et** le README des modules concernés, dans la même PR.
- `pnpm lint` fait partie de `pnpm check`.
- Un test `apps/api/src/__tests__/boundaries.test.ts` lint des fixtures permanentes (`apps/api/src/__tests__/fixtures/boundaries/`, incluses dans le tsconfig) et vérifie le `ruleId` exact : `conversations` → `fans/infra/...` refusé, `fans` → `conversations/index.ts` refusé (hors graphe), `conversations` → `fans/index.ts` accepté.

## Modules et phases

| Module | Phase d'apparition | État |
|---|---|---|
| connectors | 0 (Fake), 2 (Reveal) | `FakeConnector` et enregistreur `/v1/connector/sessions` ; Reveal attend la capture (ADR 0018) |
| conversations | 0 | ingestion, machine d'état, brouillons, envoi vérifié, mode de l'agent et verrou de l'Automatique (ADR 0019, 0022), faits du brief à l'approbation (`conversation.record_facts`) |
| fans | 3 | faits (P3-02), drapeaux et routes `/v1/fans/:id/flags`, purge à 12 mois (`fans.purge_facts`) |
| persona | 3 | versions de persona, créatrices et activation d'une version (`/v1/creators`) |
| agent | 3 | composeur sens → cerveau → politique → voix → gardes, drapeaux posés sur un risque ; aucun message réel tant que les clés manquent |
| media | 3 (sens), 6 (catalogue) | descriptions au vocabulaire Nirvana, ffmpeg vérifié au démarrage ; la lecture des médias Reveal attend la capture |
| supervision | 4 | Dashboard (`/v1/dashboard`) : santé, jobs bloqués, taux en réel ; « À traiter » de toutes les créatrices suivies et le compte de chacune (`/v1/dashboard/todos`, une transaction RLS par créatrice, SUIVI-09 et DASH-03) |
| sales | 6 | non créé : offres à prix codés, ventes détectées, règles de prix ; propriétaire de `offers`, `sales` (montants en centimes entiers + devise) |
| scripts | 6 | non créé : structures, étapes, cartons, runs de script par conversation (machine d'état explicite) ; propriétaire de `scripts`, `script_steps`, `script_runs`, `cards` |
| playground | 3 | API de l'écran Entraîner (P3-06) |
| providers (clés des services IA, ADR 0016) | 3 | clés vérifiées et scellées, routes `/v1/settings/providers`, page Services, revérification toutes les 15 minutes (P3-03) |
| telegram (alertes de l'équipe, ADR 0020) | 3 | bots et groupes depuis Réglages › Telegram (`/v1/settings/telegram`), alertes vérifiées de bout en bout (P3-07) |
| team (équipe, ADR 0023, ADR 0024) | équipe | membres, taux de commission et rôles datés (job `team.apply_roles`), préréglages, notes internes, routes `/v1/team` (EQ-01) ; les créatrices existantes lui viennent de `persona` par le composition root |
| scheduling (planning, ADR 0023, ADR 0025, ADR 0031) | équipe | réglages, shifts, modèles de la semaine et leur job horaire, « en poste » et « mes shifts », congés et échanges de shifts (job `scheduling.lapse_swaps`), routes `/v1/scheduling` (EQ-02) ; rapports de fin de shift et règles de paie des comptes, routes `/v1/scheduling/shift-reports` et `/v1/team/pay-rules` (EQ-03) ; les créatrices et leurs noms lui viennent de `persona` par le composition root |
| backups (sauvegardes, ADR 0028) | mise en production | lecture de `backup_runs` écrite par le service `backup`, route `/v1/backups/status` (propriétaire), contrôle horaire des 26 h qui publie `backup_overdue` (OPS-02) |
| alerts (alertes personnalisées, P4-01) | 4 | ses alertes à elle, une ligne par créatrice sous RLS, alertes système activées par créatrice, routes `/v1/alerts` (propriétaire) ; l'agent les lira par `activeFor` et `systemOn`, et l'historique de `conversations` nomme ses alertes par `names` (port `AlertNames`, branché par le composition root) |
| payroll (paie, ADR 0023) | équipe | relevés de commissions par quinzaine avec les règles d'Imperium, au centime en entiers (EQ-04) ; calcul pur, contrats, tables (migrations 0028, 0029, 0031 et 0040, clôture de la quinzaine, ADR 0032, détails du paiement ; 0041 et 0042, factures et avoirs des prestataires, EQ-06), recalcul des brouillons par job (`payroll.recalculate`, `payroll.recalculate_open`), émission de la facture et des avoirs d'un relevé validé par job (`payroll.issue_invoices`, EQ-06 lot 3), `GET /v1/payroll/periods` (la liste, par curseur), `GET /v1/payroll/periods/:period` et `GET /v1/payroll/entries` (les saisies d'une quinzaine), `POST /v1/payroll/statements/:id/validate` (la première validation clôture la quinzaine pour l'équipe), `…/pay` (propriétaire seul, avec le jour, le moyen, la référence et le montant envoyé), primes, malus et ajustements d'un membre sous les verrous (`/bonuses`, `/penalties`, `/adjustments`), paliers et minimum de versement datés d'une quinzaine pas commencée, objectif collectif jusqu'au 3e jour, délai de versement annoncé, par le propriétaire (`/bonus-tiers`, `/payout-minimums`, `/collective-goals`, `/settings`), lecture du dernier taux par le propriétaire et un manager actif (`/exchange-rates`) et job des taux de la BCE (`payroll.fetch_exchange_rates`, ADR 0033) ; lit les rapports (`scheduling`), les membres (`team`) et les créatrices (`persona`) par un port du composition root |
| content (Instagram) | 7 | non créé |
| platform (Nirvana propre) | 8 | non créé, voir `own-platform.md` |

## Ajouter un module

Voir `docs/playbooks/add-a-module.md`. En bref : README d'abord (rôle, dépendances, tables), puis contrats, puis domaine testé, puis le reste, puis l'entrée dans le graphe ci-dessus et dans `eslint.config.js`.
