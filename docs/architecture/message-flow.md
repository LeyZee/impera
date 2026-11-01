# Le chemin d'un message

Dernière revue : 2026-10-16.

## 1. Entrée

```
Plateforme ──(poll toutes les N s, ou WebSocket)──▶ Connector.listConversations / fetchMessages
                                                        │
                                                        ▼
                                   conversations.ingestMessage(cmd)      [transaction]
                                     • upsert fan (platform_fan_id)
                                     • upsert conversation
                                     • INSERT message  (UNIQUE platform_message_id → doublon = no-op silencieux)
                                     • event message_received
                                     • si inbound : addJob('conversation.respond', { conversationId },
                                         { queueName: 'conv:'+id, jobKey: 'respond:'+id, jobKeyMode: 'replace',
                                           runAt: now + debounceFor(conversation, persona) })
                                     • la relance en attente ne partira pas : son ancre (son dernier message) a bougé
```

Le debounce (30 à 90 s, selon la persona et l'heure) fait qu'un fan qui envoie trois messages d'affilée obtient une seule réponse qui les prend tous en compte. Le `queueName` garantit qu'aucun autre job ne touche la conversation en même temps.

## 2. Le job `conversation.respond`

Exécuté par le worker, strictement en série par conversation :

```
0. Garde-fous d'entrée : kill switch ? mode human/paused ? session plateforme expirée ? → event + sortie
1. Contexte  = assembleContext(conversationId)                          [lecture]
     persona active (version), faits actifs du fan, résumé, N derniers messages (budget de tokens),
     médias entrants non décrits, état cooldowns/script, heure locale créatrice
2. Sens      = pour chaque média entrant sans description → media.describe (job séparé si > 1, puis re-enqueue respond)
3. Cerveau   = llm.brain(context) → Brief (Zod) : intent, sentiment, facts_proposed[], kyc_missing[],
               risks[], action (reply|offer|wait|follow_up|handoff), reply_brief, tone_hints
4. Politique = policy.evaluate(context, brief) → Decision (code pur, testé) :
               • risques bloquants (mineur suspecté, détresse, rencontre, paiement hors plateforme, litige) → handoff
               • action offer autorisée ? (cooldowns, droits média, phase 6 : prix/plancher)
               • horaires de la persona (hors horaires → wait + runAt)
               • brief.intent == 'asks_if_bot' → réponse en personnage, jamais d'aveu (ADR 0021)
               • KYC : au plus une question, seulement si naturel
5. Voix      = llm.voice(context, decision) → bubbles[] (texte, découpage, emojis selon persona)
6. Gardes    = guards.check(bubbles, context, decision) → ok | violations[]
               • dégoûts/mots interdits (persona), anti-répétition (N derniers envois), longueur,
                 mention d'argent hors offre, mention IA/prompt/système, données d'un autre fan,
                 URL/coordonnées, langue
               → violation : une régénération avec le retour des gardes, puis échec = draft 'failed' + notification
7. Draft     = INSERT drafts (brief, bubbles, versions, traces) + event draft_created
8. Suite     = mode copilot → notify supervision (SSE) ; mode auto et catégorie autorisée → approveDraft(system)
```

Chaque étape écrit sa trace (`policy_trace`, `guard_trace`) sur le draft : on peut toujours répondre à « pourquoi le bot a dit ça ».

Code actuel : les étapes 1 à 6 sont derrière le port `DraftComposer` (module `conversations`), implémenté par l'adaptateur de l'agent. Le job se déroule en trois temps, pour ne garder aucun verrou pendant que le moteur réfléchit :

- Une transaction en lecture : gardes d'entrée, état `pending`, 40 derniers messages, contexte du fan.
- `compose` hors transaction.
- Une transaction qui re-verrouille la conversation. Si le fan a réécrit entre-temps (`last_inbound_at` a bougé), ou si une garde s'est fermée, le résultat est jeté et le prochain debounce répond.

Le moteur peut aussi ne pas écrire de brouillon (`held`) :

- `guard_blocked`, `handoff`, `budget_reached` et `llm_unavailable` donnent `handoff_requested` : la conversation passe à `human` et les chatteurs reprennent. Un modèle injoignable (fournisseur en panne, clé absente) ne laisse donc plus un fan sans réponse ni alerte : la cause `llm_unavailable` part en alerte « Important ».
- `no_reply` donne `reply_skipped` et la conversation revient à `idle`. Les anciens `reply_skipped` de raison `llm_unavailable` restent lisibles.
- **Note de désir** (P3-12) : le moteur reçoit la dernière note écrite et son heure (`ComposeInput.desire`), et ne rend une nouvelle note, avec son brouillon ou son attente, que si elle a bougé par rapport à la note retombée jusqu'à maintenant. Le worker écrit alors `desire_scored` dans la même transaction, avant l'événement du résultat. Sans note rendue, rien n'est écrit, pas même l'heure. Un résultat abandonné parce que le fan a réécrit n'écrit pas de note.
- **Réponse différée** (P3-11) : quand elle choisit d'attendre (« attends, je reviens »), le moteur rend `no_reply` avec `retryAt`. Entre 5 et 25 minutes, `reply_skipped` porte ce `retryAt` et `conversation.respond` est remis en file à cette heure, sur `conv:<id>` et la même clé (`replace`), avec `waitedFor` (son message attendu). Un nouveau message du fan remplace ce job : le debounce répond à ce message-là. Au second passage, le job accepte la conversation au repos tant que son message est toujours le dernier et sans réponse d'elle, et le moteur reçoit `waited: 1` (elle ne peut plus attendre). Un brouillon s'écrit comme d'habitude ; sinon, quoi que rende le moteur, c'est `handoff_requested` (cause `other`, raison `waited_no_reply`). Hors de la borne, un `reply_skipped` simple, sans reprise.
- **Heures d'activité** (P3-14) : avant tout, le job lit ses heures (`creators.agent_hours`, port `ReplyHours`, à son heure à elle). Hors de ses créneaux de réponse, aucun brouillon ni appel de modèle, qu'un chatteur soit en poste ou non : le chatteur répond dans Reveal (ADR 0025), et les heures existent pour qu'elle ne réponde pas à 4 h. La conversation reste `pending`, le journal reçoit `reply_deferred` (acteur `system`, raison `outside_hours`, `until` = l'ouverture suivante), et un seul job `conversation.reopen` par créatrice (clé `conversation.reopen:<creatorId>`, `replace`) est programmé à cette ouverture. À l'ouverture, ce job remet en file `conversation.respond` pour chacune de ses conversations encore `pending` (un message humain venu de Reveal a déjà fait taire l'agent sur ce fan), l'attente la plus longue d'abord puis une toutes les `RESUME_SPACING_SECONDS`, en `preserve_run_at` : un fan dont le debounce court garde son heure, et un job mort après ses tentatives repart. Chaque réponse relit les heures et se repousse encore si elles ont changé. Changer ses heures (`PUT /v1/creators/:id/agent-hours`) déplace ce job, dans la même transaction, à l'ouverture suivante selon les nouvelles heures, maintenant si elle est ouverte. Une attente qu'elle a choisie (P3-11) laisse la conversation au repos : elle garde son propre job, à l'ouverture, avec `waitedFor`. Une erreur de lecture des heures remonte et le job rejoue. Un réglage stocké qui ne se lit plus vaut les défauts, avec un `warn` au journal et `invalidStored` à l'écran. Sans le port `ReplyHours`, elle est toujours ouverte, comme avant. Le moteur reçoit ses heures (`ComposeInput.hours`) pour les relances et la bascule Jour / Nuit.

Le job n'envoie jamais rien lui-même.

## 3. Approbation et envoi

```
approveDraft(draftId, by)  [transaction]  → status approved|edited, event, addJob('conversation.send', …, queueName conv),
                                           addJob('conversation.record_facts') si le brief a proposé des faits (P3-02)
rejectDraft(draftId, by, reason)          → status rejected, event ; raison stockée pour les évals

conversation.send :
  • relit le draft (encore valide ? conversation toujours en idle/awaiting ? pas de nouveau message inbound depuis ? sinon → expired + re-respond)
  • humanisation : délai de frappe ∝ longueur, jitter ; bulles envoyées une à une avec intervalle
  • pour chaque bulle : Connector.sendText(conversationId, text, idempotencyKey = draft.id + ':' + index)
  • event send_attempted → send_verified (Connector.verifySent relit la conversation) ou send_failed
  • INSERT messages (outbound, author ai|human, draft_id)
  • échec : retry borné (3) ; au-delà → draft failed, notification, conversation en error jusqu'à action humaine
```

Avant toute approbation, retouchée ou non, les bulles repassent les gardes dures de l'agent (port `BubbleGuard`, `AgentBubbleGuard`) : jamais d'IA, pas de rencontre, pas de contact, limites de la créatrice, bulle par bulle et sur le message entier démasqué. Une garde bloquante refuse l'approbation (422 `draft_unprocessable`, `details.guards` donne les codes) et le brouillon reste en attente. Les gardes lisent aussi les vingt derniers messages de la conversation, les siens et ceux du fan, et savent qu'un brouillon ne porte jamais de média : annoncer une photo qui ne part pas (`media_not_sent`) est refusé (P3-13). Les codes sont la liste fermée `GUARD_CODES` des contrats. Les gardes douces (longueur, nombre de bulles, tics, répétition, questions fermées en série) restent l'affaire du chatteur. Les gardes sont celles de la version active de sa persona, lues avant chaque approbation (`BubbleGuard.forCreator`) ; sans version active, rien n'est approuvé (422 `persona_inactive_unprocessable`) : il n'y a jamais d'approbation sans ses gardes (revue 09, G5 ; recette 28/10, G4).

Mode auto : `CreatorSettings.auto_approve_categories` (ex. `['small_talk','kyc','media_reaction']`) ; tout le reste reste copilote. Le passage en auto est progressif (roadmap phase 5).

## 4. Après l'envoi

- **Mémoire** : les `facts_proposed` du brief deviennent `fan_facts` avec `kind` et `confidence` ; en copilote, l'approbation du draft vaut confirmation. Tous les N messages (config), job `fans.refresh_summary`.
- **Relance** (P3-10) : quand un message d'elle est vérifié envoyé, `conversation.send` programme `conversation.follow_up` au premier délai de `persona.follow_ups.delays_hours` encore à venir, compté depuis le dernier message du fan (l'ancre), sur `conv:<id>` avec `job_key = conversation.follow_up:<id>` (une seule relance en attente), et écrit `follow_up_scheduled`. Le job relit sous verrou : conversation au repos (`idle`), ancre inchangée, sa réponse à elle après l'ancre, étape encore prévue par la persona, aucune porte fermée. Sinon il écrit `follow_up_cancelled` et s'arrête : un message du fan, une prise en main ou une pause annulent donc la relance sans retirer le job. Sinon le moteur reçoit `followUp { step, steps, silentSince }`, décide si elle part et l'écrit : un brouillon à valider comme toute réponse (jamais un envoi direct), puis l'envoi programme l'étape suivante avec la même ancre. Au-delà du dernier délai, plus rien. Un refus du moteur (`no_reply`) avec `retryAt` (ses heures calmes) reprogramme la même étape à cette heure, à huit jours au plus (son prochain créneau de réponse peut être loin, P3-14) ; sans, un refus, un modèle injoignable ou un budget atteint n'écrivent rien ; une garde ou une passation donnent la main aux chatteurs. Sans le port `FollowUpPlan` (délais de la persona, module agent), rien n'est programmé. Une activation de persona ne recalcule rien en arrière : une relance déjà programmée garde son heure, part avec la version active quand elle part (le brouillon porte cette version), et s'annule (`follow_up_cancelled`) si cette version n'a plus son étape ou n'a plus de relances ; l'étape suivante prend les délais de la version active à l'envoi. Sans version active, rien n'est écrit (`follow_up_persona_inactive`).
- **Ventes** (phase 6) : `sale_detected` vient du connecteur (poll des transactions ou message typé) et met à jour `media_sends`, `sales`.

## 5. Prise en main humaine

- `takeover(conversationId, by)` : state `human`, event, le bot ne génère plus. Permis aussi sur une conversation déjà à `human` (après une remise à l'humain) : la prise en main ferme l'alerte Telegram. L'humain écrit depuis le dashboard (envoi via le même `conversation.send`, `author: human`).
- `release(conversationId, by, note?)` : state `idle`, la note est ajoutée en `fan_fact` catégorie `operator_note`, le bot relit tout l'historique à sa prochaine réponse.
- `handoff` demandé par la politique : state `human` + notification urgente ; la conversation ne redevient automatique qu'à `release`.

## 6. Interrupteurs

`kill_switches` à trois niveaux. Le job `respond` et le job `send` les relisent à chaque exécution. L'approbation d'un brouillon les relit aussi : interrupteur actif ou session expirée, elle est refusée (409 `kill_switch_conflict` ou `session_expired_conflict`) et le brouillon reste en attente. Le job `send` les relit avant chaque bulle : un brouillon arrêté ainsi expire, et rien ne repart tout seul quand l'interrupteur est levé. Un interrupteur « envois seulement » existe : le bot continue de proposer (copilote), rien ne part.

Le contrôle du Dashboard passe par `PUT /v1/agent/mode { creatorId, mode }` (propriétaire ou opérateur de la créatrice) :

- **Arrêt** pose l'interrupteur de la créatrice, sans ré-authentification : un arrêt d'urgence doit être immédiat.
- **Copilote** le lève et repasse en copilote toute conversation restée en automatique.
- **Automatique** n'ouvre que derrière le verrou de l'ADR 0019 : il lève l'interrupteur de la créatrice et passe en automatique toutes ses conversations en copilote. Verrou fermé, il est refusé (409 `agent_mode_conflict`, `details.missing` dit ce qui manque, sous la forme `automatic.missing` du Dashboard). Pas de ré-authentification pour y passer : le verrou et les rôles suffisent (choix par défaut du 19/10, à revoir par Charles quand l'Automatique sera réellement possible).
- **À la reprise** (Copilote ou Automatique depuis Arrêt, ou interrupteur levé depuis le terminal, `ops.ts`), chaque fan qui a écrit pendant l'arrêt reçoit sa réponse sans réécrire (`conversation.respond`). Les réponses partent l'une après l'autre : le fan qui attend depuis le plus longtemps tout de suite, puis une toutes les `RESUME_SPACING_SECONDS` (15 s, `packages/contracts`), pour qu'un long arrêt ne réveille pas tous les appels de modèle et tous les envois à la même seconde.

### Le verrou de l'Automatique (ADR 0019)

Une seule lecture, dans le module `conversations` (`readAutomaticLock`, dont `readAutomaticGate` ne garde que le verrou), avec la règle de `packages/contracts` (`automaticGate`) : une version de persona active (sinon `active_persona` manque, recette 28/10, G4), taux en réel d'au moins 80 % sur au moins 100 brouillons décidés (fenêtre de 200) de la version active de la voix, et dernier test à l'aveugle de cette version d'au moins 80 %. La version active (prompt et modèle de la voix) est définie une seule fois, par la racine de composition ; un test à l'aveugle ne vaut que pour elle. Le Dashboard affiche ce que `conversations` lit, sans recalculer le verrou : le verrou et le taux en réel sur lequel il a été décidé, pour que le taux affiché et ce qui manque ne se contredisent jamais. Seule la tendance (le taux d'il y a trois semaines) est lue par `supervision`, avec la même sélection et le même ordre.

- Les deux portes passent par lui : `PUT /v1/agent/mode` et `POST /v1/conversations/:id/mode`, chacune sous le verrou de transaction de la créatrice.
- Le test à l'aveugle s'enregistre par `POST /v1/creators/:id/blind-tests { rate }` : propriétaire seulement, connexion de moins de 10 minutes, version et date posées par le serveur, ligne `audit_log` `blind_test.record`. Table `blind_tests`, append-only.
- **Retour en copilote sans demander** : après chaque décision d'un chatteur (approuver, modifier, rejeter), après chaque test à l'aveugle, et au début de chaque `conversation.respond`, avant le moteur. Si une conversation est en automatique et que le verrou est fermé (taux tombé, voix ou persona changée qui n'a encore rien prouvé, plus de persona active), toutes ses conversations en automatique repassent en copilote (`mode_changed`, acteur `system`) et un seul événement `automatic_closed` part pour le propriétaire. Le verrou de la créatrice est pris avant ceux des conversations, dans l'ordre de tout changement de mode.
- Aujourd'hui rien ne part sans décision humaine : `send` n'envoie qu'un brouillon approuvé. Le jour où un brouillon partira en automatique, `send` relira le verrou avant de l'envoyer, sans quoi un brouillon en file partirait après la fermeture.

Chaque changement écrit sa ligne `kill_switches`, son événement `kill_switch_toggled` et sa ligne `audit_log` dans la même transaction. Un clic qui ne change rien n'écrit rien. Les changements d'une même créatrice passent l'un après l'autre (verrou de transaction), et la ligne prend l'heure de la base une fois le verrou tenu : le dernier clic appliqué reste la dernière ligne. La réponse donne le mode en vigueur, sous la forme de `GET /v1/dashboard` : Arrêt tant que l'interrupteur global reste posé, avec `globalStop: true` pour que l'écran dise pourquoi. `GET /v1/dashboard` porte le même `globalStop`, pour que l'écran le dise encore après un rechargement.

## 7. Réconciliation

Job `connector.reconcile` toutes les 10 min : relit la liste des conversations et les N derniers messages de celles actives, compare avec la base, ingère ce qui manque (idempotent), marque les envois non retrouvés comme `send_failed` si plus vieux que 5 min. C'est le filet de sécurité contre les messages perdus et les envois fantômes.

## 8. Invariants (testés)

1. Deux jobs `respond` ne s'exécutent jamais en parallèle pour la même conversation.
2. Un `platform_message_id` n'est inséré qu'une fois.
3. Un draft ne part que si aucun message inbound n'est arrivé après sa création.
4. Aucune bulle n'est envoyée deux fois (idempotency key).
5. Un draft envoyé a toujours `persona_version_id` et `prompt_hashes`.
6. Une violation de garde bloquante n'est jamais envoyée, même en mode auto.
7. En mode `human`, `paused` ou kill switch actif, aucun appel LLM n'est fait.
