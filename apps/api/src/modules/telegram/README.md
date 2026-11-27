# Module `telegram`

**Rôle.** Le canal Telegram de chaque créatrice, et lui seul (ADR 0080, ADR 0176) : brancher un bot sur un canal, régler ses créneaux, ses posts et ses sondages. Depuis le 27/11/2026, Telegram ne prévient plus l'agence de rien : les alertes passent par le module `notifications` (job `alerts.agency` du module `alerts`), et le chat privé du « mot de passe oublié » n'existe plus.

**Peut dépendre de.** Aucun module. `packages/contracts` ; l'infra lit les créatrices (`creators`) en lecture seule et parle à l'API Bot de Telegram. Le composition root branche la voix des posts (`agent`, `channelWriterPersona`) et les liens de redirection (`redirect-links`).

**Tables possédées.** `telegram_bots`, `telegram_chats` (migration 0006) et `telegram_channels` (migration 0137, le canal de chaque créatrice ; RLS forcée sans politique) : hors RLS, retirées au rôle applicatif, lues et écrites par `withAdmin`. Le jeton d'un bot est scellé par `CREDENTIALS_ENCRYPTION_KEYS` (contexte `telegram_bot:<id>`). `telegram_routes`, `telegram_deliveries`, `telegram_state`, `telegram_settings` et les tables du chat privé restent en base, plus lues ni écrites (ADR 0176 § 11) : leur suppression attend le mot écrit de Charles. La migration du 27/11 retire le déclencheur `domain_events_telegram_scan`.

**Routes.** `/v1/settings/telegram` : `GET`, `POST /bots`, `PUT /bots/:id/token`, `POST /bots/:id/listen`, `DELETE /bots/:id`, `DELETE /chats/:id`, derrière `requireRole('owner')` ; ajouter, remplacer ou supprimer un bot demande une connexion de moins de 10 minutes. `DELETE /chats/:id` (REG-28) retire un canal que le bot a quitté ou dont il a été exclu, et rien d'autre : un canal où le bot est encore répond 409 `telegram_chat_member_conflict`. Ces canaux restent dans `GET` (`membership` `left` ou `kicked`) jusqu'à ce retrait.

**Canal de la créatrice (ADR 0057, ADR 0080).** `GET` et `PUT /v1/creators/:creatorId/telegram-channel`, propriétaire seulement ; `PUT` demande une connexion de moins de 10 minutes (les liens de redirection décident où arrivent ses lecteurs). Le réglage est stocké entier (`TelegramChannelConfigSchema`) : le canal (un `telegram_chats` de sorte `channel`, découvert comme les groupes, jamais tapé), les créneaux (4 posts par jour au plus, 3 h d'écart au moins, minuit compris), la fenêtre d'aperçu, « Publier sans validation », les liens de redirection et celui du canal. Un refus répond 400 `telegram_channel_invalid` avec sa sorte (`domain/channel.ts`) ; une créatrice absente ou archivée, 404. Un canal ne sert qu'une créatrice (clé unique `telegram_channels_chat_unique`, qui tranche aussi deux enregistrements simultanés) ; celui d'une créatrice archivée revient à qui le choisit ensuite. La colonne `chat_id` fait foi : un chat supprimé (`ON DELETE SET NULL`) se lit « aucun canal choisi », et un canal de créatrice compte même si son réglage ne se lit plus. L'audit compte (créneaux, liens), il ne copie jamais une adresse. Depuis INS-03 (ADR 0121 § 1) les liens de redirection se règlent dans le module `redirect-links` : le canal les lit par `channelLinks` (liens allumés seulement), ne garde que le choix du lien du canal, et un `PUT` qui change les liens est refusé (`links_moved`) ; un lien du canal éteint ou absent donne l'avertissement `no_link`. La publication elle-même (lot A3) n'existe pas encore.

**Jobs.** `TELEGRAM_JOB_PAYLOADS` (contracts) ; le worker les branche sur `module.jobs` :

- `telegram.dispatch_polls` (chaque minute) puis `telegram.poll_updates` (file `telegram-bot:<id>`) : canaux découverts par `getUpdates`. Un message privé au bot (un `/start` compris) est lu et laissé : le bot ne répond à personne.

## Règles propres

- Le client HTTP ne journalise jamais une URL ni une erreur brute : le jeton est dans l'URL.
- Un seul lecteur `getUpdates` par jeton (file série par bot). Un 409 venu d'ailleurs passe le bot « utilisé ailleurs ».
- Au démarrage, `start()` rescelle avec la clé la plus récente tout jeton scellé avec une ancienne (rotation, `docs/runbooks/rotate-secrets.md`).
- L'IA ne renvoie jamais un fan de Reveal vers Telegram ; un post du canal ne porte rien d'explicite (ADR 0080 § 5).
- Le bot ne pilote rien : aucun bouton d'action, seulement des liens.

## Structure

- `domain/` : canal et post, appartenance, forme du jeton, textes d'erreur, ports. Pur, testé.
- `application/` : lecture des bots et des canaux, relevé des mises à jour, réglage du canal, essai d'un post.
- `infra/` : client de l'API Bot (réponses validées par Zod), magasins Postgres, voix du canal, routes.
- `index.ts` : `startTelegramModule(options)` pour le composition root, `createTelegramModule(deps)` pour les tests.
