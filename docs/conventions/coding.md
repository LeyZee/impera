# Conventions de code

## Langage et typage

- TypeScript strict (`tsconfig.base.json` : `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`). ESM partout (`"type": "module"`).
- Pas de `any`. Pas de `as X` pour contourner le typage ; un `as const` ou un garde de type (`is`) sont les seules formes acceptées. `unknown` aux frontières, puis Zod.
- Pas de classes pour le domaine sauf machines d'état et erreurs. Fonctions pures + types. Les services d'infra peuvent être des classes ou des fabriques `createX(deps)`.
- Injection de dépendances **manuelle** : chaque module exporte `createXModule(deps)` ; chaque module est assemblé par son fichier `apps/api/src/wiring/<module>.ts` (services, routes, jobs nommés d'après lui), et `apps/api/src/composition-root.ts` garde l'ordre d'assemblage et les dépendances communes ; lui seul importe `wiring/` (ADR 0047 § 3, vérifié par ESLint). Pas de conteneur DI.
- Erreurs : une classe de base `DomainError` (code, message, `cause`), des sous-classes par module (`ConversationNotFound`, `SendRejected`), jamais de `throw "string"`. Les résultats attendus (validation, refus) sont des valeurs : un type `Result<T, E>` maison dans `packages/contracts` (pas de `neverthrow`), les imprévus sont des exceptions.
- Identifiants : UUID v7 (`v7()` de la bibliothèque `uuid`), générés par l'application, typés par marque (`type ConversationId = Brand<string, 'ConversationId'>`).
- Argent : entiers en centimes + code devise ISO (`{ amountMinor: number; currency: 'EUR' }`). Jamais de nombre à virgule.
- Dates : `Date` en mémoire, `timestamptz` en base, ISO 8601 UTC sur le fil. Voir `operations.md` pour les fuseaux.
- Pas d'`enum` TypeScript : des unions de littéraux dérivées de `z.enum` (ESLint le refuse).
- Nommage des données : camelCase dans le JSON des API et dans les colonnes `jsonb`, snake_case pour les tables et colonnes SQL ; Drizzle fait la correspondance.

## Organisation

- Un module = un dossier `apps/api/src/modules/<name>/` avec `domain/`, `application/`, `infra/`, `index.ts`, `README.md`, `__tests__/` à côté du code testé (`*.test.ts`).
- Export public uniquement via `index.ts`. Nommage des exports : `createConversationsModule`, types `Conversation`, commandes `IngestMessageCommand`, handlers `ingestMessage`.
- Un fichier = une responsabilité ; au-delà de ~300 lignes, on découpe.
- Les schémas Zod partagés vivent dans `packages/contracts` et sont la source des types (`z.infer`). On ne duplique pas un type à la main.
- Les requêtes SQL vivent dans `infra/*.repository.ts` ; le domaine ne connaît pas Drizzle.

## Style

- Prettier décide de la forme (`.prettierrc`). Pas de débat.
- ESLint : `typescript-eslint` strict + `eslint-plugin-boundaries` (règles générées depuis `MODULE_DEPENDENCIES` dans `eslint.config.js`, voir `docs/architecture/modules.md`) + `eslint-plugin-import-x` (ordre, pas de cycles). Une règle désactivée localement demande un commentaire `// eslint-disable-next-line <règle> -- <raison>`. Les règles de frontière ne se désactivent jamais. Un commentaire écrit comme texte JSX (`// …` hors accolades) est refusé : il s'afficherait à l'écran (`JSX_COMMENT_TEXT`, l'équivalent sans greffon de `react/jsx-no-comment-textnodes`).
- Noms : anglais, explicites, pas d'abréviation sauf `id`, `db`, `llm`. Booléens en `is/has/can`. Fonctions en verbe. Événements au passé (`MessageReceived`), commandes à l'impératif (`IngestMessage`).
- Commentaires : pourquoi, pas quoi. Un `TODO` porte un identifiant de fiche (`// TODO(P2-03): …`), sinon `scripts/check-repo.mjs` le refuse dans `pnpm check`.
- Logs : `logger.info({ conversationId, jobId }, 'draft created')`. Objet d'abord, message court en anglais, jamais de contenu de message.
- Erreurs dans les logs : on passe l'erreur telle quelle sous `err` (`logger.warn({ err: error, creatorId }, '…')`). Le sérialiseur de `apps/api/src/logger.ts` n'en garde que le nom, le message (sans les valeurs d'une requête SQL), le code (SQLSTATE ou code réseau) et les lignes de la pile. La cause, le `detail` d'un pilote et les `params` de Drizzle ne partent jamais, et la charge utile d'un job Graphile non plus (ADR 0010).
- Corrélation : chaque requête HTTP porte un `x-request-id` (généré s'il manque) ; il devient `correlationId` dans les jobs et les appels LLM qu'elle déclenche et figure dans chaque ligne de log (`requestId`, `correlationId`). Détail dans `docs/architecture/operations.md`.

## Asynchrone et robustesse

- Tout appel externe a un timeout et une politique de retry explicites (`p-retry` ou équivalent), bornés.
- Les jobs sont idempotents : relancer un job terminé ne refait rien de visible.
- Les transactions sont courtes ; jamais d'appel LLM ou HTTP dans une transaction.
- Pas d'état en mémoire entre deux requêtes/jobs (le worker peut redémarrer à tout moment).

## Prompts

- Les prompts sont des fichiers dans `packages/llm/prompts/<role>/<name>.md` avec en-tête YAML (`version`, `role`, `model_hint`, `output_schema`). Ils sont chargés et hachés ; le hash est stocké dans `llm_calls` et sur le draft.
- Un prompt ne contient pas de logique métier (prix, règles) : il reçoit des faits déjà décidés.
- Les variables sont injectées par un template strict (pas de concaténation de chaînes), et le contenu non fiable passe par `wrapUntrusted()`.

## Front (apps/web)

- Composants fonctionnels, hooks, TanStack Query pour les données, TanStack Router pour les routes typées, Tailwind + shadcn/ui pour l'UI.
- L'inbox copilote est faite pour la vitesse : raccourcis clavier (approuver, éditer, rejeter, suivant), focus géré, pas de modale pour les actions fréquentes.
- Pas d'état global sauf session utilisateur et préférences.
