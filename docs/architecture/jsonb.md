# Colonnes `jsonb` : ce qui reste en jsonb, ce qui devient colonne

Dernière revue : 2026-10-27 (audit du 27/10, fil Bilan). Aucune migration dans cette note : chaque changement ci-dessous passe par sa propre PR, et la suppression d’une colonne attend une demande explicite de Charles (CLAUDE.md, règle 12).

## Le compte

Le schéma applicatif a **24** colonnes `jsonb`. C’est le même nombre dans `packages/db/src/schema/*.ts` et dans le dernier snapshot de migration. Le chiffre de 33 de l’audit ne correspond pas à ce schéma ; il comptait probablement des colonnes hors de notre schéma, celles de `graphile_worker` par exemple (non vérifié). Aucun index et aucun `CHECK` ne portent aujourd’hui sur un `jsonb`.

## La règle

- **Colonne** quand le code filtre, trie ou décide sur la valeur : une règle métier se lit en SQL et se contraint par `CHECK` (règle 3).
- **jsonb + Zod** quand la forme est ouverte ou varie par type, et qu’on ne la requête pas : un document versionné, une trace, une donnée brute de plateforme.
- Dans les deux cas, on parse à l’**écriture** autant qu’à la lecture (règle 6). Un `.catch` qui remplace une valeur illisible par des défauts est interdit sur une garde ; ailleurs, il journalise.
- Un `jsonb` qu’on garde reçoit `CHECK (jsonb_typeof(col) = 'object')` (ou `'array'`) : la base refuse un scalaire écrit par erreur.

## Ce qu’on change, dans cet ordre

| Priorité | Colonne | Décision | Pourquoi |
|---|---|---|---|
| 1 | `platform_accounts.connector_config` → `writes` | **colonne** `writes boolean not null default false` ; le reste reste jsonb + Zod | C’est la garde qui ouvre l’envoi à un vrai fan. Aujourd’hui `ConnectorConfigSchema.catch(…)` (connectors `account-store.ts`) remplace une config illisible par les défauts sans le dire. La garde doit être visible, requêtable, sans repli muet. |
| 2 | `drafts.prompt_hashes` | **colonnes** `voice_prompt text`, `voice_model text`, index `(voice_prompt, voice_model, decided_at)` | Seul jsonb filtré dans un chemin décisionnel : le taux de l’Automatique (ADR 0019) lit `prompt_hashes->>'voicePrompt'` et `->>'voiceModel'` (conversations `unit-of-work.ts`, supervision `dashboard-reader.ts`). `blind_tests` et `calibration_ratings` les ont déjà en `text`. |
| 3 | `conversation_events.payload`, `domain_events.payload` | **jsonb + Zod à l’écriture + CHECK `object`** | Union discriminée par `type` : reste jsonb. Aujourd’hui un seul écrivain sur cinq parse (`budget-events.ts`), et `insertEvent` des connecteurs prend `payload: unknown`. On parse `EVENT_PAYLOADS[type]` dans chaque écriture. Les lectures `payload->>'cause'` et `->>'day'`/`'kind'` restent : un index d’expression si le Dashboard ralentit. |
| 4 | `messages.platform_media` | **jsonb + Zod à l’ingestion + CHECK `array`** | Donnée de la plateforme : rien ne la parse à l’entrée, et le vrai connecteur Reveal arrive. La frontière du connecteur est le bon endroit (règle 6). |
| 5 | `fans.flags` | **jsonb + CHECK `object`** maintenant ; colonnes quand un écran filtre les fans gelés ou « ne pas contacter » | Déjà parsé à l’écriture et à la lecture (`FanFlagsSchema`, strict). |
| 6 | `drafts.brief`, `drafts.guard_trace` | **jsonb + Zod à l’écriture** | Faits proposés et trace des gardes, jamais requêtés. `drafts.brief` illisible devient aujourd’hui `[]` en silence : on journalise. |
| 7 | `audit_log.details` | **jsonb + CHECK `object`** | Journal libre par action, sans lecteur applicatif : un Zod par action serait du travail sans lecteur. |

## Ce qui est déjà juste

`provider_credentials.facts`, `settings` et `voices` sont parsés en lecture, sur une ligne par fournisseur. `persona_versions.content` est un document versionné et haché, parsé à l’écriture et à la lecture ; il lui faudra un *upcast* le jour où `PersonaSchema` change.

## Les colonnes mortes

Douze colonnes ne sont ni lues ni écrites au runtime :

- `conversations.cooldowns` ;
- `drafts.policy_trace` ;
- `fans.kyc_state` (les cases du KYC vivent dans `fan_facts`) ;
- `fans.platform_meta` ;
- `creators.settings` (`CreatorSettingsSchema` n’est branché nulle part) ;
- `media_assets.rights` ;
- `media_descriptions.content` ;
- `notifications.payload` ;
- les trois colonnes de `calibration_ratings` : les notes vivent en JSONL dans le module agent.

Les supprimer, c’est une migration `DROP` : **elle attend une ADR et le mot de Charles**.

D’ici là, la règle est simple. Un module qui commence à écrire l’une de ces colonnes suit la règle ci-dessus, dans sa propre PR. Par exemple :

- un cooldown devient une colonne `<kind>_until timestamptz`, puisqu’une règle métier se requête ;
- `creators.settings` reste en jsonb, parsé par `CreatorSettingsSchema`.

## Requêtes SQL qui entrent dans un jsonb

| Où | Colonne | Expression | Après la priorité indiquée |
|---|---|---|---|
| conversations `unit-of-work.ts`, supervision `dashboard-reader.ts` | `drafts.prompt_hashes` | `->>'voicePrompt'`, `->>'voiceModel'` | remplacées par les colonnes (2) |
| supervision `dashboard-reader.ts` | `conversation_events.payload` | `->>'cause'` (avec `type = 'handoff_requested'`) | restent (3) |
| `apps/api/src/budget-events.ts` | `domain_events.payload` | `->>'day'`, `->>'kind'` | restent (3) |
