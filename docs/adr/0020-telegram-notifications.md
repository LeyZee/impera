# 0020. Notifications Telegram : bots, groupes et routage gérés depuis le CRM

Statut : proposed
Date : 2026-10-17

## Contexte

La nuit, l'agent tourne seul. Quand il s'arrête pour un fan (mineur possible, non-consentement, détresse, demande de rencontre, manipulation), quand la session Reveal expire, quand le plafond du jour approche ou qu'un interrupteur d'arrêt est tiré, personne ne regarde le CRM. Charles a choisi Telegram le 17/10 à 21h44 : son équipe y vit déjà, c'est du push mobile gratuit et il n'y a pas d'écran d'alerte à construire.

Charles a précisé deux fois sa demande :
- À 21h49, il veut créer et gérer les bots comme les clés des services IA (ADR 0016) : une marche à suivre guidée, plusieurs bots, les groupes où chacun se trouve, un système robuste.
- À 22h05, il veut que Telegram ait sa propre page, avec un onglet par sujet : les alertes, une annonce à chaque vente payée sur Reveal, un mot-clé dit par un fan, et ce qui attend une validation humaine (un vocal ElevenLabs, par exemple).

La fiche P3-07 décrit le travail.

Faits Telegram qui contraignent le choix :

- Un bot ne se crée pas par API. Seul @BotFather le crée (`/newbot`) et donne un jeton.
- Un jeton est lu soit par `getUpdates` (le serveur interroge Telegram), soit par un webhook (Telegram appelle le serveur), jamais les deux. Deux lecteurs `getUpdates` simultanés sur le même jeton se coupent l'un l'autre (409).
- Un bot apprend qu'on l'a ajouté à un groupe, ou retiré, par une mise à jour `my_chat_member`. Un groupe qui devient supergroupe change d'identifiant (`migrate_to_chat_id`).
- Limites d'envoi : environ 20 messages par minute dans un même groupe, 30 par seconde pour un bot. Au-delà, Telegram répond 429 avec `retry_after`.
- Telegram est un tiers. Il n'offre pas de clé d'idempotence : un envoi rejoué après une coupure peut arriver deux fois.

## Décision

1. **Module `telegram`**, distinct de `supervision`. `supervision` garde les notifications dans le CRM (table `notifications`, SSE, Web Push). `telegram` transforme des événements en messages et les livre dans des groupes. Le module ne dépend d'aucun autre : il lit l'outbox `domain_events` et les tables qu'il possède. Le mail de secours du bilan sera un second canal, derrière le même port `NotificationChannel`.

2. **Six sujets, classés en code** (règle 3 de `CLAUDE.md`). Le classement est une table du domaine, testée, jamais un prompt. Chaque onglet de la page règle un ou plusieurs sujets.

   | Onglet | Sujet | Ce qui le déclenche | Son |
   |---|---|---|---|
   | Alertes | `urgent` | relais humain pour mineur possible, non-consentement, détresse, demande de rencontre, manipulation | oui |
   | Alertes | `important` | plafond du jour à 80 % ou atteint, session plateforme expirée, interrupteur d'arrêt activé, autre relais humain | oui |
   | Alertes | `info` | bilan du matin, retour à la normale | non |
   | Ventes | `sale` | vente payée, bilan du soir | non |
   | Mots-clés | `keyword` | un mot surveillé dans un message de fan | oui |
   | Validations | `validation` | un vocal ou un brouillon attend un humain | oui |

3. **Événements consommés et leurs producteurs.** Un onglet s'allume quand son événement existe. D'ici là, l'écran le montre « bientôt » plutôt qu'avec un faux contenu.

   | Événement (`domain_events`) | Sujet | Producteur | Existe ? |
   |---|---|---|---|
   | `handoff_requested` { `conversationId`, `cause` } | urgent si `cause` ∈ minor, non_consent, distress, meeting, manipulation ; important pour guard, budget, llm_unavailable, other, persona_inactive (#304 : elle n'a pas de persona active, l'agent n'écrit rien) ; `keyword`, `custom_alert`, `identity_doubt` : voir `alert_triggered` | contrat : Bilan ; `cause` remplie par l'agent (composeur, vision) | oui (#54, `keyword` par #56) |
   | `budget_threshold_crossed` { `kind` : alert \| reached, `spentMinor`, `capMinor`, `currency`, `day` }, sans créatrice | important (les deux) | contrat : Bilan ; publié dans `onBudget` (`apps/api/src/llm.ts`) | oui (#54) |
   | `backup_overdue` { `lastSucceededAt` (null si aucun export n'a jamais réussi), `day` }, sans créatrice | important, une fois par jour tant qu'aucun export n'a réussi depuis 26 h | contrat : Bilan ; publié par le job `backups.check` (module `backups`, ADR 0028 § 5, OPS-02) | oui (migration 0020 pour le déclencheur) |
   | `exchange_rate_overdue` { `currency`, `lastRateDay` (null si aucun taux n'est jamais arrivé), `day` }, sans créatrice ; seuls la devise et le jour du dernier taux sont lus | important, une fois par jour et par devise tant qu'aucun taux de la BCE n'est arrivé depuis plus de deux jours ouvrés | contrat : Bilan ; publié par le job `payroll.fetch_exchange_rates` (ADR 0033) | oui (migration 0032 pour le déclencheur) |
   | `invoice_not_issued` { `memberId`, `statementId`, `period`, `document`, `reason`, `amountMinor` }, sans créatrice ; seuls la quinzaine, le document et le motif sont lus, jamais le prestataire ni le montant | important, une fois par relevé, document, motif et montant (le job de facturation ne republie pas un refus déjà dit) | contrat : Équipe ; publié par le job `payroll.issue_invoices` (EQ-06 lot 3, ADR 0036) | oui (migration 0044 pour le déclencheur) |
   | `session_state_changed` | important, info | connecteurs | oui |
   | `kill_switch_toggled` | important, info | ops | oui |
   | `automatic_closed` { `missing`, `conversations` ; la version de voix n'est pas lue } | important | Bilan, verrou de l'Automatique (ADR 0019, #91) | oui (migration 0009 pour le déclencheur) |
   | `send_failed` avec `isFinal` = true et `conversationId` (le code d'erreur n'est pas lu) | important, fil de la conversation (fermé par une prise en main ou un retour à l'agent) | Bilan (liste publiée de `journal.ts`) | lu par le module (migration 0012 pour le déclencheur, recette R-G5) ; publié (recette R-G4) |
   | `takeover_started` avec `conversationId` | met à jour le message d'origine | Bilan (liste publiée de `journal.ts`) | oui (#54, `conversationId` par #60) |
   | `takeover_ended` avec `conversationId` | met à jour le message d'origine s'il n'est pas déjà fermé (après une remise à l'humain, la conversation est déjà aux humains : la rendre à l'agent ferme l'alerte) | Bilan (liste publiée de `journal.ts`, `conversationId` dans le payload) | lu par le module (migration 0011 pour le déclencheur) ; publié (recette R-G4) |
   | `sale_detected` avec `conversationId`, l'auteur de la vente et le nom de l'offre | sale | connecteur Reveal, après la capture (lots A/B) ; contrat : Bilan | à compléter et publier |
   | `alert_triggered` { `conversationId`, `trigger.alert`, `notify` ; ni `matchedBy` ni le mot déclaré ne sont lus } (remplace `keyword_matched`, qui n'a jamais eu de producteur) | une alerte qui prévient seulement (P4-01) : son sujet est celui du contrat (`CUSTOM_ALERT_TOPIC` = `custom` pour ses alertes, `SYSTEM_ALERT_TOPICS` pour celles du système), sans fil à fermer ; rien quand `notify` est faux. Le message nomme l'alerte comme l'historique du Suivi (nom de son alerte, `SYSTEM_ALERT_LABELS` pour le système), jamais le mot déclaré. Une alerte qui met en pause est un `handoff_requested` de cause `keyword`, `custom_alert` ou `identity_doubt` : il part dans le sujet de l'alerte, ou dans `important` si aucun groupe ne le reçoit, et se ferme comme toute remise | contrat : Bilan (#242) ; l'agent (mots de la persona #239, alertes personnalisées et système en B2) | lu par le module (migration 0027 pour le déclencheur) ; publié avec B2 |
   | `validation_requested` / `validation_resolved` { `validationId`, `kind`, `conversationId`, `by` } | validation | vocaux (copilote), API du copilote | à créer, producteurs à venir |

   Le bilan du matin et le bilan du soir des ventes sont produits par le module lui-même, à heure fixe dans le fuseau de la créatrice.

4. **Plusieurs bots, des groupes découverts, un routage.** Des tables réglages de l'agence hors RLS (comme `provider_credentials`), retirées au rôle `nirvana_app`, lues et écrites par `withAdmin` dans le module :
   - `telegram_bots` : un bot, son jeton scellé, son identité Telegram, son état, son curseur `getUpdates`.
   - `telegram_chats` : un groupe où un bot se trouve, découvert, jamais saisi à la main.
   - `telegram_routes` : quel sujet va dans quel groupe, pour une créatrice ou pour toutes.
   - `telegram_settings` : les réglages d'un sujet (montant minimum d'une vente, ventes de l'agent seulement), ajoutée avec l'onglet Ventes.
   - `telegram_deliveries` : un message à livrer dans un groupe, unique par (source, groupe).
   - `telegram_state` : une ligne, le curseur du scan et la version du routage.

5. **Le jeton est un secret de l'agence.** Il est scellé en AES-256-GCM avec `CREDENTIALS_ENCRYPTION_KEYS` (contexte `telegram_bot:<id>`), comme les clés IA, et vérifié par `getMe` avant d'être gardé. Aucune route ne le renvoie. Ajouter, remplacer ou supprimer un bot est réservé au propriétaire, avec la redemande du mot de passe après 10 minutes (ADR 0016, #41). Le jeton fait partie de l'URL de l'API Telegram (`/bot<jeton>/…`). Le client HTTP du module ne journalise donc jamais une URL ni une erreur brute : il les traduit d'abord en un type d'erreur. Ni l'extension ni `.env` ne portent de jeton en production. Au démarrage, le module rescelle avec la clé la plus récente tout jeton scellé avec une ancienne : une rotation de `CREDENTIALS_ENCRYPTION_KEYS` (`v2:<nouvelle>,v1:<ancienne>`) couvre les bots sans geste, et `v1` peut partir quand plus aucune ligne ne l'utilise.

6. **Le worker interroge Telegram (`getUpdates`), pas de webhook.** Derrière Coolify, il n'y a ni URL publique à exposer ni secret de webhook à tenir. À la connexion d'un bot, le module appelle `deleteWebhook`. Le job `telegram.poll_updates` tourne dans la file série `telegram-bot:<id>` : un seul lecteur par jeton, jamais de 409 entre nos propres jobs. Il tourne chaque minute, et à la demande pendant que l'écran attend un groupe, en appel long de 20 secondes. Un 409 venu d'ailleurs veut dire que le jeton sert à un autre programme : le bot passe « utilisé ailleurs » et l'écran le dit.

7. **Les messages naissent de l'outbox `domain_events`, sans en manquer.** Un déclencheur `AFTER INSERT` sur `domain_events`, limité aux types consommés, enfile `telegram.scan` avec une clé de job unique, par `enqueue_job`. Le message part dès le commit, une rafale ne produit qu'un scan, et un événement annulé n'enfile rien. Le scan relit une fenêtre de deux minutes derrière son curseur, parce que des transactions concurrentes peuvent se valider dans le désordre. La contrainte unique (source, groupe) rend ce recouvrement sans effet. Un cron d'une minute rattrape un déclencheur manqué. Le déclencheur ne fait jamais échouer l'écriture de l'outbox : une erreur d'`enqueue_job` est avalée avec un avertissement, et le cron rattrape.

8. **Livraison par groupe, à la cadence de Telegram.** `telegram.flush_chat` tourne dans la file série `telegram-chat:<id>`. Il prend tous les messages en attente du groupe, les plus graves d'abord. Si plusieurs attendent, il les regroupe en un seul message, sans jamais mélanger un message sonore et un message silencieux. Des textes identiques n'y sont dits qu'une fois, suivis de leur nombre (« (×20) »). Il garde trois secondes entre deux messages d'un même groupe et suit `retry_after` sur un 429.
   - Erreur réseau ou 5xx : nouvel essai avec un délai croissant, pendant une heure.
   - 403 (bot retiré du groupe) : le groupe passe « retiré » et ses routes « cassées ».
   - 401 (jeton révoqué) : le bot passe « à reconnecter ».
   - `migrate_to_chat_id` : mise à jour de l'identifiant, puis nouvel envoi.

9. **Rejeu : au moins une fois pour l'urgent, au plus une fois pour le reste.** Un message passe `sending` avant l'appel. Si le worker meurt avant de le marquer `sent`, l'urgent est renvoyé, avec la mention « (renvoi) » ; un doublon vaut mieux qu'un silence. Les autres passent alors `unknown`, sans renvoi.

10. **Aucune donnée de fan chez Telegram, sur aucun onglet.** Un message contient le sujet, la créatrice, une raison en français écrite par le code et un lien vers le CRM. Il ne contient ni le texte du fan, ni son pseudo, ni un média, ni la voix de la créatrice (ADR 0010).
    - Une vente donne le montant, le nom de l'offre et qui l'a vendue.
    - Un mot-clé donne le mot surveillé, pas la phrase.
    - Une validation donne un bouton-lien « Écouter et valider » qui ouvre l'écran de validation du CRM. Le vocal reste chez nous.
    - Le texte part en HTML échappé, sans aperçu de lien.

11. **Le fil d'un message se ferme dans Telegram.** Quand un humain prend la conversation (`takeover_started`) ou traite une validation (`validation_resolved`), le message d'origine est modifié (`editMessageText`) : « ✓ Pris en main par <prénom> ». Quand la session revient ou que l'interrupteur est relâché, une réponse silencieuse au message d'origine dit « Résolu ». Le groupe voit ce qui reste à faire sans ouvrir le CRM.

12. **Personne ne doit croire être prévenu à tort.** L'API calcule une couverture : pour chaque créatrice active, au moins un groupe joignable reçoit l'urgent. Sans couverture, la page et le Dashboard le disent (« Personne n'est prévenu la nuit »). Une alerte urgente qu'aucun groupe ne peut recevoir est journalisée en erreur, avec sa raison.

13. **Le bot ne pilote rien.** Aucune commande Telegram n'agit sur l'agent. Les boutons sont des liens vers le CRM (`url`), pas des actions (`callback_data`). Le bot lit seulement les mises à jour d'appartenance aux groupes. Valider depuis Telegram même demanderait de relier chaque compte Telegram à un utilisateur du CRM : ce serait une décision nouvelle.

## Conséquences

- Réglages › Telegram a cinq onglets : Alertes, Ventes, Mots-clés, Validations, Bots et groupes. La création d'un bot se fait en quatre étapes guidées. Chaque onglet a son routage par créatrice, et la page montre la santé (dernière lecture, dernier envoi, échecs) et un test d'envoi.
- Le lot 1 est le moteur et l'onglet Alertes, les seuls dont les événements existent ou sont demandés. Ventes, Mots-clés et Validations s'allument avec leurs producteurs, sans changer le moteur : un sujet de plus dans la table de classement et dans la liste du déclencheur.
- Telegram sait qu'un message a eu lieu, pour quelle créatrice, à quelle heure, et le montant d'une vente. Il ne sait rien du fan. C'est le prix d'un push mobile gratuit, accepté par Charles.
- Une fuite de la base seule ne livre pas les jetons. Une fuite de la base et de l'environnement, oui : rotation par `docs/runbooks/rotate-secrets.md`, plus une révocation dans @BotFather (`/revoke`).
- `telegram_deliveries` est purgée après 30 jours (`telegram.purge`). Un message n'est pas une preuve, le journal des conversations l'est.
- À surveiller : si Nirvana sert plusieurs agences, les tables du module prennent une colonne d'agence et une politique RLS, comme `provider_credentials`.

## Alternatives rejetées

- **Le jeton dans `provider_credentials`** (première idée de la fiche) : la table tient une ligne par fournisseur, et il faut plusieurs bots, chacun avec ses groupes et son curseur.
- **Webhook** : il faut une URL publique, un secret par bot et un routage Coolify en plus. Un serveur arrêté perd aussi les mises à jour au-delà de 24 heures, alors que `getUpdates` les rattrape au redémarrage.
- **Identifiant de groupe saisi à la main** : personne ne connaît le `chat_id` d'un groupe, et une faute de frappe envoie les messages dans le vide. La découverte par `my_chat_member` ne laisse choisir qu'un groupe où le bot est vraiment.
- **Lire `domain_events` seulement par un cron d'une minute** : une alerte urgente pourrait attendre près d'une minute. Le déclencheur la fait partir au commit.
- **Envoyer le vocal à valider dans Telegram** : la voix clonée de la créatrice partirait chez un tiers, ce que l'ADR 0010 exclut.
- **Détecter les mots-clés dans ce module** : arrêter l'agent pour un fan est une règle de l'agent, et le module ne doit pas lire les messages des fans.
- **Web Push de la PWA seul** : il dépend d'un navigateur ouvert ou installé sur chaque téléphone, et l'équipe ne vit pas dans la PWA.
