# Modules et frontières

Dernière revue : 2026-10-16.

## Anatomie d'un module

```
apps/api/src/modules/<name>/
├── README.md          rôle, dépendances autorisées, tables possédées
├── index.ts           porte d'entrée publique : createXModule(deps), types, commandes
├── pure.ts            (facultatif, ADR 0051) seconde entrée : réexportations de règles pures de son domain/
├── domain/            types, règles pures, machines d'état, erreurs. Zéro I/O.
├── application/       cas d'usage : commandes, requêtes, handlers de jobs
├── infra/             repositories Drizzle, routes Fastify, tâches Graphile, clients externes
└── __tests__/         ou *.test.ts à côté du code
```

- `domain/` importe : `packages/contracts`, d'autres fichiers de `domain/`, le `pure.ts` des modules autorisés par le graphe ci-dessous. Rien d'autre. Pas de `node:` non plus sauf `node:crypto` pour les UUID.
- `pure.ts` (ADR 0051) ne contient que des réexportations (`export { … } from './domain/…'`, `export type { … } from './domain/…'`) de types, fonctions pures, constantes et erreurs de son propre `domain/` ; il n'écrit rien lui-même, n'importe que son `domain/` et `@nirvana/contracts`, ni paquet npm ni `node:` sauf `node:crypto`. Il sert quand le domaine d'un module a besoin d'une règle pure d'un module dont il dépend (le domaine ne peut pas importer un `index.ts`, qui porte la fabrique et l'infra).
- `application/` importe : `domain/`, les **ports** (interfaces) définis dans `domain/ports.ts`, `packages/contracts`, l'`index.ts` et le `pure.ts` des modules autorisés par le graphe ci-dessous (et seulement ceux-là : ESLint génère la règle depuis `MODULE_DEPENDENCIES`).
- `infra/` importe : tout ce qui précède, `packages/db`, `packages/llm`, Fastify, Graphile, clients HTTP.
- Un autre module n'importe que `modules/<name>` (son `index.ts`) ou `modules/<name>/pure` (son `pure.ts`). Jamais `modules/<name>/domain/...`, `application/...` ni `infra/...`. Un `domain/` n'importe jamais l'`index.ts` d'un autre module, seulement son `pure.ts`.

## Graphe de dépendances autorisé

```
connectors ──▶ conversations (événements entrants : IngestMessage, SessionStateChanged, SaleDetected)
conversations ──▶ fans, persona, agent, media
agent ──▶ fans, persona, media, packages/llm
supervision ──▶ conversations, fans
media ──▶ packages/llm
sales ──▶ conversations, media            (phase 6, non créé)
scripts ──▶ (feuille pour l'instant ; limites de la persona par le composition root, SC-01)
playground ──▶ agent, packages/llm        (écran Entraîner, P3-06)
payroll ──▶ contractors                   (paie en quatre modules, ADR 0047 § 1)
invoicing ──▶ payroll, contractors       (factures et avoirs, ADR 0047 § 1)
accounting ──▶ payroll, invoicing, contractors  (exports du comptable, ADR 0047 § 1)
fans, persona, providers, telegram, team, backups, scheduling, alerts, contractors, notifications, scripts ──▶ (feuilles)
```

Ce graphe est **sans cycle**, et `import-x/no-cycle` le vérifie. Deux inversions le rendent possible :

- **Envoi** : `conversations` ne dépend pas de `connectors`. Il définit le port `OutboundSender` (`sendText`, `sendMedia`, `verifySent`) dans `conversations/domain/ports.ts` ; `connectors` l'implémente et le composition root l'injecte dans `createConversationsModule(deps)`.
- **Supervision** : `conversations` ne dépend pas de `supervision`. `supervision` apprend qu'un draft existe par l'événement `draft_created` (outbox), et agit sur les conversations par leur `index.ts` (`approveDraft`, `takeover`, …).

**Tables et jobs de la paie** (ADR 0047 § 1) : `apps/api/src/__tests__/architecture.test.ts` lit les sources et vérifie que chaque table de `packages/db/src/schema/payroll.ts` et `invoices.ts` a un seul propriétaire, celui dont le README la nomme dans « Tables possédées » ; qu'entre `payroll`, `invoicing`, `contractors` et `accounting` une table n'est lue que par son propriétaire, les autres passant par les lecteurs que son `index.ts` exporte (fiche ARC-07) ; que chaque job a une seule tâche, écrite dans un seul fichier de `wiring/` ; et qu'un job de la paie n'est mis en file que par le module qui enregistre sa tâche.

Un cycle est une erreur de conception, pas un cas à autoriser. Si `fans` a besoin de `conversations`, c'est que la responsabilité est au mauvais endroit, ou qu'il faut un événement.

## Communication entre modules

1. **Appel direct** via l'`index.ts` du module cible, pour les lectures et les commandes synchrones simples.
2. **Événements de domaine** pour tout ce qui doit être découplé ou différé : un module écrit un événement dans `conversation_events` (ou `domain_events` pour le hors-conversation) **dans la même transaction** que son changement d'état (outbox). Un job Graphile les distribue aux abonnés. C'est ainsi que `supervision` apprend qu'un draft existe, que `fans` apprend qu'un fait est confirmé, que `sales` apprend qu'un envoi payant a eu lieu.
3. **Jobs** pour le travail asynchrone (`conversation.respond`, `conversation.record_facts`, `media.describe`, `fans.refresh_summary`, `conversation.follow_up`, `conversation.reopen`, `conversation.release_unavailable`, `connector.poll`, `connector.reconcile`). Nom = `<module>.<verbe>`.

## Propriété des tables

Chaque table a exactement un module propriétaire (voir le README de chaque module). Un module lit les tables des autres **uniquement** via leur `index.ts` (requêtes exposées), jamais par SQL direct. Les vues SQL du tableau de bord (`apps/api/src/modules/supervision/infra/views/`) sont l'exception documentée : lecture seule, agrégats.

## Application des règles

- `eslint.config.js` : la constante `MODULE_DEPENDENCIES` reproduit le graphe ci-dessus et **génère** les politiques de la règle `boundaries/dependencies` (eslint-plugin-boundaries 7, `default: disallow`) : un module n'importe que l'`index.ts` et le `pure.ts` des modules listés, jamais leurs dossiers internes ; `domain/` n'importe que son propre `domain/`, `@nirvana/contracts` et le `pure.ts` des modules listés ; `pure.ts` n'importe que son `domain/` et `@nirvana/contracts`, sans aucun paquet npm, et `no-restricted-syntax` y refuse tout ce qui n'est pas une réexportation de `./domain/` ; sans I/O (ni `node:*` sauf `node:crypto`, ni Drizzle, Fastify, Graphile, `pg`, `undici`) ; les SDK LLM sont interdits hors `packages/llm`. `import-x/no-cycle` interdit les cycles. Éléments : `module` (un dossier `apps/api/src/modules/<nom>`, ses couches `domain`, `application`, `infra`, `index.ts`, `pure.ts` distinguées par leur chemin interne), `api-root`, `api-scripts`, `api-tests`, `api-test`, `package`, `web`, `extension`, `evals`. Le test `apps/api/src/__tests__/boundaries.test.ts` prouve chaque protection sur des fixtures. Une violation = erreur de lint = CI rouge.
- Modifier le graphe = modifier `MODULE_DEPENDENCIES` **et** ce document **et** le README des modules concernés, dans la même PR.
- `pnpm lint` fait partie de `pnpm check`.
- Un test `apps/api/src/__tests__/boundaries.test.ts` lint des fixtures permanentes (`apps/api/src/__tests__/fixtures/boundaries/`, incluses dans le tsconfig) et vérifie le `ruleId` exact : `conversations` → `fans/infra/...` refusé, `fans` → `conversations/index.ts` refusé (hors graphe), `conversations` → `fans/index.ts` accepté ; pour `pure.ts` (ADR 0051) : un `pure.ts` qui réexporte son domaine accepté, le domaine de `payroll` → `contractors/pure.ts` accepté, un `pure.ts` qui importe son `infra/` ou un paquet npm refusé, un `pure.ts` qui écrit une fonction refusé, un domaine → `pure.ts` d'un module hors de sa liste refusé, un domaine → fichier du domaine ou `index.ts` d'un autre module refusé.

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
| scripts (ADR 0056) | scripts | structures de script de l'agence et leurs versions (figées dès qu'une demande les prend), file de structures par créatrice filtrée par les limites de sa persona, routes `/v1/script-structures` et `/v1/creators/:creatorId/script-queue` (SC-01 lot a) ; à venir : cartons, demande et parcours, nomenclature, runs de script par conversation |
| playground | 3 | API de l'écran Entraîner (P3-06) |
| providers (clés des services IA, ADR 0016) | 3 | clés vérifiées et scellées, routes `/v1/settings/providers`, page Services, revérification toutes les 15 minutes (P3-03) |
| telegram (alertes de l'équipe, ADR 0020) | 3 | bots et groupes depuis Réglages › Telegram (`/v1/settings/telegram`), alertes vérifiées de bout en bout (P3-07) |
| team (équipe, ADR 0023, ADR 0024) | équipe | membres, taux de commission et rôles datés (job `team.apply_roles`), préréglages, notes internes, routes `/v1/team` (EQ-01) ; les créatrices existantes lui viennent de `persona` par le composition root |
| scheduling (planning, ADR 0023, ADR 0025, ADR 0031) | équipe | réglages, shifts, modèles de la semaine et leur job horaire, « en poste » et « mes shifts », congés et échanges de shifts (job `scheduling.lapse_swaps`), routes `/v1/scheduling` (EQ-02) ; rapports de fin de shift et règles de paie des comptes, routes `/v1/scheduling/shift-reports` et `/v1/team/pay-rules` (EQ-03) ; pourcentage de l'agence par créatrice, routes `/v1/creators/:creatorId/agency-rates` (CR-04) ; les créatrices et leurs noms lui viennent de `persona` par le composition root |
| backups (sauvegardes, ADR 0028) | mise en production | lecture de `backup_runs` écrite par le service `backup`, route `/v1/backups/status` (propriétaire), contrôle horaire des 26 h qui publie `backup_overdue` (OPS-02) |
| alerts (alertes personnalisées, P4-01) | 4 | ses alertes à elle, une ligne par créatrice sous RLS, alertes système activées par créatrice, routes `/v1/alerts` (propriétaire) ; l'agent les lira par `activeFor` et `systemOn`, et l'historique de `conversations` nomme ses alertes par `names` (port `AlertNames`, branché par le composition root) |
| payroll (paie, ADR 0023) | équipe | relevés de commissions par quinzaine avec les règles d'Imperium, au centime en entiers (EQ-04) ; calcul pur, contrats, tables (migrations 0028, 0029, 0031 et 0040, clôture de la quinzaine, ADR 0032, détails du paiement ; 0041 et 0042, factures et avoirs des prestataires, EQ-06 ; 0054, vérification des pièces ; 0055, rappel des pièces ; 0057, effacement des pièces refusées ; 0059, alerte d'échéance des factures), recalcul des brouillons par job (`payroll.recalculate`, `payroll.recalculate_open`), émission de la facture et des avoirs d'un relevé validé par job (`payroll.issue_invoices`, EQ-06 lot 3), dossier du prestataire écrit par lui ou le propriétaire, vérifié et préfixé par le propriétaire (`/contractors/:memberId/file`, `…/profile`, `…/profile/verify`, `…/profile/prefix`), versions du contrat et du mandat et leur acceptation par le prestataire lui-même (`/contract-texts`, `…/:textId/accept`), relance de l'émission en attente quand ils changent (`payroll.requeue_invoice_issues`, EQ-06 lot 5a), régimes de facturation ajoutés, validés par le comptable et attribués datés par le propriétaire (`/billing-regimes`, `…/:regimeId/validation`, `/contractors/:memberId/regimes`, EQ-06 lot 5b), pièces du prestataire déposées par lui ou le propriétaire dans le premier bucket des factures, lues sous leur empreinte et vérifiées une fois par le propriétaire (`/contractors/:memberId/documents`, `…/:documentId/file`, `…/:documentId/review`, EQ-06 lot 5c), rappelées une fois au propriétaire avant leur échéance par job horaire (`payroll.remind_documents`, EQ-06 lot 5c-2), effacement nocturne du fichier d'une pièce refusée à la fin de son verrou (`payroll.purge_refused_documents`), relance quotidienne de toute l'émission en attente (crontab), acceptation, contestation et refus d'un document (`/invoices/:invoiceId/acceptance`, `…/accept`, `…/contest`, `…/contest/refuse`), acceptation tacite et alerte de contestation par job (`payroll.lapse_invoice`, `payroll.announce_invoice_contest`) avec leur balayage horaire (`payroll.sweep_invoice_acceptance`, EQ-06 lot 6a), `GET /v1/payroll/periods` (la liste, par curseur), `GET /v1/payroll/periods/:period` et `GET /v1/payroll/entries` (les saisies d'une quinzaine), `POST /v1/payroll/statements/:id/validate` (la première validation clôture la quinzaine pour l'équipe), `…/pay` (propriétaire seul, avec le jour, le moyen, la référence et le montant envoyé), primes, malus et ajustements d'un membre sous les verrous (`/bonuses`, `/penalties`, `/adjustments`), paliers et minimum de versement datés d'une quinzaine pas commencée, objectif collectif jusqu'au 3e jour, délai de versement annoncé, par le propriétaire (`/bonus-tiers`, `/payout-minimums`, `/collective-goals`, `/settings`), lecture du dernier taux par le propriétaire et un manager actif (`/exchange-rates`) et job des taux de la BCE (`payroll.fetch_exchange_rates`, ADR 0033) ; lit les rapports (`scheduling`), les membres (`team`) et les créatrices (`persona`) par un port du composition root ; depuis ADR 0047 § 1, les réglages de facturation, le dossier, les régimes, les pièces et leurs jobs vivent dans `contractors`, les factures, avoirs et leurs jobs dans `invoicing` (la paie leur parle par `PayoutGate` et `AfterValidation`, branchés par le composition root), et les exports du comptable dans `accounting`, routes et noms de jobs inchangés |
| contractors (dossier du prestataire, ADR 0047 § 1) | équipe | sorti de `payroll` sans changer un comportement : réglages de facturation et logo, dossier, contrat et mandat, régimes de facturation, pièces du prestataire, leur rappel (`payroll.remind_documents`), l'effacement des pièces refusées (`payroll.purge_refused_documents`) et le verrou de l'attestation d'un versement (`payroll.lock_payout_certificate`), routes sous `/v1/payroll/…` ; premier `pure.ts` (ADR 0051), lu par le domaine de la paie ; ses tables ne sont lues ailleurs que par `contractorReadsForAccounting` et `contractorReadsForInvoicing` (ARC-07) |
| invoicing (factures et avoirs, ADR 0047 § 1) | équipe | sorti de `payroll` sans changer un comportement : émission, PDF/A et copies, acceptation et contestation, facture rectificative, rapprochement des versements, liste et échéances, routes `/v1/payroll/invoices/…` et neuf jobs `payroll.*` ; tables `invoices` et `invoice_*` ; donne à la paie `payoutGate` et `invoicesAfterValidation`, au dossier `invoiceRequeue` et `invoiceReadsForContractors`, à l'archive `checkedPdf` ; écrit les corrections d'une contestation par `correctContest` de la paie ; lit les tables de la paie et du dossier seulement par `payReadsForInvoicing` et `contractorReadsForInvoicing` (ARC-07 lot d) |
| accounting (exports du comptable, ADR 0047 § 1) | équipe | sorti de `payroll` sans changer un comportement : journal des achats et fichier FEC, récapitulatif DAS2, archive des PDF (`/v1/payroll/accounting/journal`, `…/das2`, `…/archive`, propriétaire seul) ; aucune table, aucun job ; lit les factures par leur `pure.ts` et `checkedPdf`, et les tables de la paie, des factures et du dossier seulement par `payReadsForAccounting`, `invoiceReadsForAccounting` et `contractorReadsForAccounting` (ARC-07) |
| notifications (Web Push, CR-01, ADR 0042 § 7) | espaces | clé VAPID du serveur créée au premier usage et scellée (`push_server_keys`, hors RLS), appareils et réglages de chaque compte sous RLS (`push_subscriptions`, `notification_preferences`), routes `/v1/notifications/*` pour tous les rôles, chiffrement RFC 8291 et signature RFC 8292 sans dépendance ; règles pures de ce qui sonne (heures calmes, plafond quotidien, rafales de ventes) ; `deliver` pour les modules qui notifient, branché par le composition root |
| content (Instagram) | 7 | non créé |
| platform (Nirvana propre) | 8 | non créé, voir `own-platform.md` |

## Ajouter un module

Voir `docs/playbooks/add-a-module.md`. En bref : README d'abord (rôle, dépendances, tables), puis contrats, puis domaine testé, puis le reste, puis l'entrée dans le graphe ci-dessus et dans `eslint.config.js`.
