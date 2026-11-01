# Module `telegram`

**Rôle.** Prévenir l'équipe dans des groupes Telegram de ce qui demande son attention : les alertes (passage à l'humain, plafond IA, session expirée, arrêt de l'agent), puis les ventes, les mots-clés et les validations quand leurs événements existeront. Les bots se créent et se gèrent depuis Réglages › Telegram (ADR 0020, fiche P3-07).

**Peut dépendre de.** Aucun module. `packages/contracts` ; l'infra lit l'outbox `domain_events`, les créatrices (`creators`) et le nom des utilisateurs (`user`) en lecture seule, et parle à l'API Bot de Telegram.

**Tables possédées.** `telegram_bots`, `telegram_chats`, `telegram_routes`, `telegram_deliveries`, `telegram_state` (`packages/db/src/schema/telegram.ts`, migration 0006) : hors RLS, retirées au rôle applicatif, lues et écrites par `withAdmin`. Le jeton d'un bot est scellé par `CREDENTIALS_ENCRYPTION_KEYS` (contexte `telegram_bot:<id>`). La migration pose aussi le déclencheur `domain_events_telegram_scan`, qui enfile `telegram.scan` au commit d'un événement consommé et n'annule jamais l'écriture de l'outbox.

**Routes.** `/v1/settings/telegram` : `GET`, `POST /bots`, `PUT /bots/:id/token`, `POST /bots/:id/listen`, `DELETE /bots/:id`, `POST /chats/:id/test`, `DELETE /chats/:id`, `PUT /routes`, `GET /deliveries`, derrière `requireRole('owner')` ; ajouter, remplacer ou supprimer un bot demande une connexion de moins de 10 minutes. `DELETE /chats/:id` (REG-28) retire un groupe que le bot a quitté ou dont il a été exclu, avec ses routes (cascade), et rien d'autre : un groupe où le bot est encore répond 409 `telegram_chat_member_conflict`. Ces groupes restent dans `GET` (`membership` `left` ou `kicked`) jusqu'à ce retrait ; l'écran ne les propose plus au routage. Ses envois restent (`chat_id` à null, migration 0037) avec le titre du groupe copié dans `chat_title` : le décompte de la nuit du Dashboard et le journal « Dernières alertes » les gardent jusqu'à la purge de 30 jours. Dans la même transaction, ceux qui attendaient encore passent en échec (`chat_removed`) et ceux en cours d'envoi en `unknown`. L'unicité (source, groupe) garde le NULLS DISTINCT de Postgres : les lignes de groupes retirés ne se gênent pas, et rien de neuf ne s'écrit sans groupe.

**Jobs.** `TELEGRAM_JOB_PAYLOADS` (contracts) ; le worker les branche sur `module.jobs` :

- `telegram.scan` (file `telegram`, clé unique) : outbox → livraisons ; aussi chaque minute en rattrapage.
- `telegram.flush_chat` (file `telegram-chat:<id>`, clé par groupe) : envoie, à 3 s d'écart au plus dans un groupe.
- `telegram.dispatch_polls` (chaque minute) puis `telegram.poll_updates` (file `telegram-bot:<id>`) : groupes découverts par `getUpdates`.
- `telegram.morning_digest` (chaque heure, n'agit qu'à 8 h dans le fuseau de la créatrice) et `telegram.purge` (chaque jour, 30 jours).

**Pour le Dashboard.** `nightCounts(creatorId)` → `{ urgent, important, info }` de la nuit (20 h → 8 h, fuseau de `creators.timezone`).

## Règles propres

- Aucune donnée de fan ne part chez Telegram : un message dit le sujet, la créatrice, une raison écrite par le code et un lien vers le CRM. Les entrées du domaine n'ont aucun champ pour un texte de fan.
- Le classement des événements est une table du domaine (`domain/classify.ts`), jamais un prompt. Causes urgentes : mineur, non-consentement, détresse, rencontre, manipulation ; les autres causes sont importantes, `persona_inactive` comprise (#304). Une remise causée par une de ses alertes (`keyword`, `custom_alert`, `identity_doubt`) part dans le sujet de l'alerte (`CUSTOM_ALERT_TOPIC`, `SYSTEM_ALERT_TOPICS` du contrat), ou dans `important` si aucun groupe ne le reçoit. `alert_triggered` (une alerte qui prévient seulement) part dans ce même sujet, sans fil à fermer, et seulement si son `notify` était vrai quand elle a sonné (P4-01). Le message nomme l'alerte comme Suivi › Historique des alertes : le nom de son alerte (écrit par l'agence, lu par `alertNames` du module `alerts`, branché par le composition root), le libellé du contrat (`SYSTEM_ALERT_LABELS`) pour une alerte du système ; un nom illisible laisse la phrase générique, jamais le message en attente. `exchange_rate_overdue` (ADR 0033) part en important, sans créatrice : la devise et le jour du dernier taux de la BCE, ou « aucun taux encore arrivé », jamais un chiffre de la paie. `invoice_not_issued` (EQ-06, ADR 0036) part en important, sans créatrice : la quinzaine, le document (facture ou avoir) et le motif en clair, avec un lien vers Paie › Quinzaine ; ni le prestataire ni le montant. Comme il ne nomme personne, vingt refus d'une même quinzaine pour un même motif donnent le même texte : un envoi groupé ne le dit qu'une fois, avec son nombre (`joinTexts`, « (×20) »).
- Le client HTTP ne journalise jamais une URL ni une erreur brute : le jeton est dans l'URL.
- Un seul lecteur `getUpdates` par jeton (file série par bot). Un 409 venu d'ailleurs passe le bot « utilisé ailleurs ».
- Rejeu : l'urgent coupé en plein appel repart marqué « (renvoi) » ; le reste passe `unknown`, sans renvoi.
- Au démarrage, `start()` rescelle avec la clé la plus récente tout jeton scellé avec une ancienne (rotation, `docs/runbooks/rotate-secrets.md`).
- Le bot ne pilote rien : aucun bouton d'action, seulement des liens.

## Structure

- `domain/` : signaux, classement, rendu HTML échappé, regroupement, couverture, horaires, forme du jeton, textes d'erreur, ports. Pur, testé.
- `application/` : scan de l'outbox, livraison par groupe, lecture des bots, réglages (bots, routage, test, journal, bilan du matin, purge).
- `infra/` : client de l'API Bot (réponses validées par Zod), lecture tolérante de l'outbox, magasin Postgres, routes.
- `index.ts` : `startTelegramModule(options)` pour le composition root, `createTelegramModule(deps)` pour les tests.
