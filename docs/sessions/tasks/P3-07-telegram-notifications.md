# P3-07 Notifications Telegram : bots, groupes, routage, page Réglages › Telegram
Statut : in_progress (ID validé par Charles le 17/10 à 22h04 ; ADR 0020 proposed ; lot 1 fusionné (#59), branchement par Bilan (#71), lot 2 fusionné (#70) ; bandeau du Dashboard fait ; restent les réglages des ventes)
Phase : 3
Dépend de : P0-05, P0-07b, P3-03 (chiffrement des secrets du CRM, ré-auth #41), changements de contrat de Bilan et du fil agent (ADR 0020 §3)
Branche : claude/telegram-alerts-3urhyn

## Objectif
Ce qui demande l'attention de l'équipe arrive tout de suite dans un groupe Telegram : les alertes quand l'agent a besoin d'un humain, les ventes, les mots-clés, les validations. Charles crée et gère les bots depuis Réglages › Telegram aussi simplement qu'une clé IA. « Moins d'écrans, plus de moteur » : le moteur passe avant l'écran.

## Contexte à lire
ADR 0016 et 0020, `docs/architecture/data-model.md` (`domain_events`, `enqueue_job`), `packages/contracts/src/events.ts`, `apps/api/src/modules/conversations/application/journal.ts` (événements publiés), `apps/api/src/modules/providers` (modèle à suivre : chiffrement, routes owner, textes d'erreur uniques), `apps/api/src/crontab.ts`, `apps/web/src/settings/services` (feuille de connexion à imiter), `docs/runbooks/incident.md`. Maquette : https://claude.ai/artifact/G28Jm13R7CAgy26nobhwNg (données fictives).

## Modèle de données (migration du module, add-only, relue par Bilan)
Tables hors RLS, retirées à `nirvana_app`, accès `withAdmin` dans le module, comme `provider_credentials`.

```
telegram_bots        id uuid v7, telegram_bot_id text unique, username, display_name,
                     token_ciphertext bytea, key_version, state (active | refused | conflict),
                     updates_offset bigint, last_polled_at, last_poll_error, created_at, updated_at
telegram_chats       id, bot_id → telegram_bots (cascade), telegram_chat_id text, title, kind (group | supergroup | channel),
                     membership (member | left | kicked), can_post bool,
                     next_send_at, last_sent_at, last_error_kind, last_error_at, discovered_at, updated_at
                     unique (bot_id, telegram_chat_id)
telegram_routes      id, creator_id → creators nullable (null = toutes), topic (urgent | important | info | sale | keyword | validation),
                     chat_id → telegram_chats (cascade), created_at
                     unique (creator_id, topic, chat_id) nulls not distinct
telegram_settings    une ligne par (creator_id nullable, topic) : réglages d'un sujet, jsonb validé par Zod
                     (vente : montant minimum, ventes de l'agent seulement, bilan du soir)
telegram_deliveries  id, source_key text (id de l'événement, ou clé du bilan), chat_id, creator_id, topic,
                     action (send | edit | reply), parent_id nullable, thread_key, text, silent,
                     status (pending | sending | sent | failed | unknown), attempts, run_after,
                     telegram_message_id, error_kind, created_at, sent_at
                     unique (source_key, chat_id) ; index (chat_id, status, run_after) ; index (thread_key)
telegram_scan_cursor une ligne : last_created_at
```

Déclencheur `AFTER INSERT ON domain_events`, limité aux types consommés, qui enfile `telegram.scan` (clé de job unique). Il ne fait rien si le schéma de Graphile n'existe pas encore : le cron rattrape.

## Événements consommés
Voir ADR 0020 §3 pour les producteurs. Textes d'exemple, fictifs :

| Événement | Condition | Sujet | Texte |
|---|---|---|---|
| `handoff_requested` | `cause` ∈ minor, non_consent, distress, meeting, manipulation | urgent | « Possible mineur sur une photo. L'agent n'écrit plus à ce fan. » |
| `handoff_requested` | autre cause, ou pas encore de `cause` | important | « L'agent passe la main et attend un humain. » |
| `budget_threshold_crossed` | `alert` / `reached` | important | « Plafond IA : 16 € sur 20 €. » / « Plafond atteint : plus de génération jusqu'à minuit. » |
| `session_state_changed` | `to = expired` | important | « La session Reveal a expiré : l'agent ne lit plus rien. » |
| `session_state_changed` | retour à `valid` | info, en réponse | « Résolu : la session est revenue. » |
| `kill_switch_toggled` | `active = true` / `false` | important / info en réponse | « Agent arrêté (global) : <raison>. » / « Résolu : agent relancé. » |
| `automatic_closed` | l'Automatique s'est refermé seul (ADR 0019) | important | « Automatique refermé : l'agent est repassé en copilote sur 3 conversations. Raison : le taux en réel est à 74,5 % (objectif : 80 %). » |
| `send_failed` | `isFinal` = true : plus aucun essai ne suivra | important | « Un message de l'agent n'a pas pu partir. Il n'écrit plus à ce fan et attend un humain. » |
| `takeover_started` | un message existe pour la conversation | modification | « ✓ Pris en main par <prénom> » |
| `takeover_ended` | un message existe pour la conversation et n'est pas encore fermé | modification | « ✓ Rendu à l'agent par <prénom> » |
| `sale_detected` | paiement confirmé, au-dessus du minimum | sale | « Vente · Messa · 45,00 € · pack « Soirée », vendu par l'agent » |
| `keyword_matched` | mot surveillé | keyword | « « police » dans un message de fan. L'agent s'est arrêté pour ce fan. » |
| `validation_requested` | vocal ou brouillon en attente | validation | « Vocal de 14 s à valider » + bouton-lien « Écouter et valider » |
| cron | 8 h / 23 h dans le fuseau de la créatrice | info / sale | bilan du matin, bilan du soir des ventes |

Un événement absent de la table ne produit rien. La raison libre d'un `kill_switch_toggled` est écrite par un humain du CRM : elle est échappée et coupée à 200 caractères.

## Contrat API (`packages/contracts/src/telegram.ts`, add-only, relu par Bilan)
Toutes les routes : `requireRole('owner')`. Les écritures sur un bot passent par la ré-auth de 10 minutes (#41).

```
GET    /v1/settings/telegram                → { bots, routes, settings, coverage, version }
POST   /v1/settings/telegram/bots           { token } → 201 TelegramBot   (getMe + deleteWebhook avant d'enregistrer)
PUT    /v1/settings/telegram/bots/:id/token { token } → TelegramBot       (même telegram_bot_id, sinon telegram_bot_mismatch)
POST   /v1/settings/telegram/bots/:id/listen          → 202               (lecture longue, pendant l'étape « ajoute-le au groupe »)
DELETE /v1/settings/telegram/bots/:id                 → 204               (routes et groupes du bot supprimés)
POST   /v1/settings/telegram/chats/:id/test           → { sentAt } | erreur
PUT    /v1/settings/telegram/routes         { version, routes: [{ creatorId|null, topic, chatId }] } → { routes, version }
PUT    /v1/settings/telegram/settings/:topic { creatorId|null, settings } → settings
GET    /v1/settings/telegram/deliveries?topic=&limit=50 → journal des 30 derniers jours (aucun texte de fan : il n'y en a pas)
```

`TelegramBot` : id, username, displayName, state, lastPolledAt, chats[] (id, title, kind, membership, canPost, lastSentAt, lastError). Jamais de jeton.
`Coverage` : par créatrice active, `urgentReachable` et les sujets sans groupe.
Erreurs (une table de textes dans `domain/messages.ts`, comme `providers`) : `telegram_token_shape`, `telegram_token_refused`, `telegram_bot_exists`, `telegram_bot_mismatch`, `telegram_bot_conflict`, `telegram_chat_unreachable`, `telegram_unreachable`, `telegram_routes_version_conflict`, `reauth_required`.

Pour le Dashboard (carte Gardes de la maquette v6, « Alertes Telegram cette nuit : N ») : le module exporte par son `index.ts` une requête `nightCounts(creatorId, night)` → `{ urgent, important, info }`, la nuit allant de 20 h à 8 h dans le fuseau de la créatrice. La future route `GET /v1/dashboard` la lit ; aucune route propre n'est ajoutée.

## La page (Réglages › Telegram)
En tête : l'état (tout fonctionne, nombre de bots et de groupes, dernier envoi) et le bouton « Ajouter un bot ». Cinq onglets :
- **Alertes** : couverture, routage par niveau et par créatrice, aperçu, dernières alertes.
- **Ventes** : un message à chaque vente, groupes, ventes de l'agent ou toutes, montant minimum, bilan du soir.
- **Mots-clés** : liste par créatrice, lue dans `notifications.alert_keywords` de sa persona (API persona) et modifiée dans sa fiche Persona, jamais ici. Un mot met toujours l'agent en pause pour ce fan (PersonaSchema) : pas de réglage « Prévenir » seul tant que le besoin n'est pas exprimé.
- **Validations** : quels types de demande (vocal, brouillon en attente), dans quels groupes.
- **Bots et groupes** : bots, groupes, santé, test, remplacer le jeton, supprimer (confirmation dans la page).

Création d'un bot en quatre étapes :
1. **Crée le bot.** Bouton « Ouvrir @BotFather » (`https://t.me/BotFather`), puis `/newbot`, un nom et un identifiant qui finit par `bot`, chacun avec un bouton pour copier. @BotFather répond avec un jeton.
2. **Colle le jeton.** Vérification au collage. Le bot apparaît avec son nom, ou un texte dit quoi corriger.
3. **Ajoute-le au groupe.** Bouton « Ouvrir dans Telegram » (`https://t.me/<bot>?startgroup=impera`). L'écran écoute et affiche le groupe dès que le bot y entre.
4. **Choisis ce qu'il reçoit**, puis « Envoyer un test ».

Un onglet dont l'événement n'existe pas encore dit « bientôt » et pourquoi, sans faux contenu.

## À faire, lot 1 : moteur et alertes
- [x] Module `apps/api/src/modules/telegram` (domain, application, infra, index) et son README. Le domaine contient la table de classement, le rendu des textes, le regroupement et la couverture, sans I/O.
- [x] Port `NotificationChannel` : `getMe`, `deleteWebhook`, `getUpdates`, `send`, `edit`. Adaptateur Telegram en `fetch`, réponses validées par Zod, jamais d'URL ni d'erreur brute dans un journal. Faux canal pour les tests.
- [x] Contrat `packages/contracts/src/telegram.ts`, migration et schéma Drizzle du module, déclencheur sur `domain_events`.
- [x] Fonctions des jobs, exportées par l'index (`module.jobs`) : scan, livraison par groupe, lecture d'un bot, répartition des lectures, bilan du matin, purge. Les noms `telegram.*`, le composition root, le worker et le crontab sont posés par Bilan (branchement du 17/10 : module actif dès que `CREDENTIALS_ENCRYPTION_KEYS` est posée, `budget_threshold_crossed` produit par la passerelle LLM, jetons rescellés par `pnpm ops:reencrypt-credentials`).
- [x] Routes ci-dessus pour les bots, les groupes, le routage et le journal.
- [x] Test qui prouve que pendant l'attente d'un humain la conversation reste `handoff_requested` et que l'agent n'envoie plus rien au fan jusqu'à la reprise. Fait par Bilan dans le module `conversations` (#60).
- [x] Glossaire : « Notification Telegram », « Sujet », « Bot », « Groupe », « Astreinte ». Runbook `docs/runbooks/telegram.md` : que faire à chaque niveau, révoquer un jeton.

## À faire, lot 2 : écran
- [x] `apps/web/src/settings/telegram/` (dossier propre, le fil Extension relit). Lignes de router et de navigation ajoutées dans la même PR, add-only, relues par le fil Extension.
- [x] Page à cinq onglets et feuille de création en quatre étapes, d'après la maquette. Ventes et Validations : routage prêt, message « arrive avec … » tant que l'événement n'existe pas.
- [x] Bandeau de couverture sur la page.
- [x] Bandeau de couverture sur le Dashboard : lu dans `GET /v1/dashboard` (`telegramCoverage`, #76), composant `settings/telegram/NightBanner.tsx`, muet quand les urgences arrivent quelque part ; « Telegram éteint » quand le serveur n'a pas de clé de chiffrement (aussi sur Réglages › Telegram).
- [ ] Ventes : réglages « ventes de l'agent ou toutes », montant minimum, bilan du soir (côté serveur d'abord, avec `sale_detected`).

## À faire, lots suivants (quand l'événement existe)
- [ ] Ventes : `sale_detected` complété et publié (connecteur Reveal), bilan du soir.
- [ ] Mots-clés : `keyword_matched` (fil agent), écran branché sur l'API de l'agent.
- [ ] Validations : `validation_requested` / `validation_resolved` (vocaux, copilote).

## Critères d'acceptation (lot 1)
- Unitaires : classement de chaque type d'événement, rendu échappé (le type d'entrée n'a pas de champ pour un texte de fan), regroupement sans mélanger son et silence, couverture.
- Intégration (Postgres, faux canal) :
  - un événement urgent inséré dans `domain_events` enfile le scan, et le scan crée la livraison ;
  - rejouer le scan ne poste qu'une fois ;
  - un 429 décale l'envoi de `retry_after` ;
  - un 403 marque le groupe retiré ;
  - un `migrate_to_chat_id` met à jour le groupe ;
  - un 401 passe le bot « à reconnecter » ;
  - une livraison urgente restée `sending` est renvoyée, une livraison info ne l'est pas ;
  - aucune route ne renvoie un jeton, et le jeton n'est pas en clair en base.
- Routes : 403 pour un `operator`, ré-auth au-delà de 10 minutes, 409 sur une version de routage périmée.
- `pnpm check`, `pnpm test:all` verts. Aucun jeton dans le dépôt, aucune donnée réelle.

## Hors périmètre
Les commandes depuis Telegram (le bot ne pilote rien), le planning d'astreinte, le mail de secours, les notifications push de la PWA, l'écran Suivi.

## Notes de session
- 17/10, fil Alertes Telegram : fiche de Bilan (#47) étendue. Le jeton quitte `providers` pour une table propre (plusieurs bots) : ADR 0020.
- 17/10 22h05 : à la demande de Charles, Telegram devient une page à part, Réglages › Telegram, avec les onglets Ventes, Mots-clés et Validations. Le module passe de `alerts` à `telegram`. Maquette refaite.
- 17/10 22h40, lot 1 : module, migration 0006 (déclencheur qui n'annule jamais l'outbox, `telegram_state` pour le curseur et la version du routage), rescellement des jetons au démarrage (condition de Bilan). Reste à Bilan : noms de jobs, composition root, worker, crontab (patch dans la PR). `conversationId` sur `takeover_started` est arrivé avec #60.
