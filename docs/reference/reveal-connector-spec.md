# Connecteur Reveal : spécification

**Statut : écrite le 2026-11-11 (P1-03)**, d'après `reveal-api-observed.md` (captures du 10/11). Décision : voie B de l'ADR 0008 confirmée (§ 1, choix de Charles du 11/11 consigné dans la fiche P1-03), sous les deux vérifications de P2-01. Les fiches P2-01 à P2-06 appliquent ce document ; un écart se corrige ici dans la même PR.

Ce que le connecteur fait, capacité par capacité : `reveal-connector-inventory.md`. Les formes de l'API : `reveal-api-observed.md`. Le faux serveur : `fake-reveal.md`.

## 1. Faisabilité de la voie B

| Question | Réponse | Source | Reste à prouver |
|---|---|---|---|
| Authentification rejouable depuis un serveur ? | Oui : un seul en-tête `authorization: Bearer`, aucun cookie, aucun en-tête maison, aucune empreinte demandée ; **V1 réussie** le 11/11 (200 depuis un serveur) | captures A, B, C ; V1 | — |
| Signatures, nonce, CSRF ? | Aucun | captures B, C | — |
| Anti-bot sur l'API ? | Aucun sur `api.reveal.me` (le script de protection tourne sur le tableau de bord seulement) | captures A, B, C | Une IP de serveur peut être traitée autrement qu'une IP résidentielle : V1 le dira |
| Durée de la session ? | 24 h : le jeton est un JWT, `exp` = `iat` + 24 h, jamais renouvelé par Reveal ; un « Synchroniser » par jour | capture A ; V1, V2 | — |
| Invalidation ? | Jeton expiré : 401, sans `www-authenticate` ni en-tête propre à Reveal (V2, 12/11) | V2 | Effet d'une connexion du membre « bot » sur un autre appareil |
| Limites de débit | 50/s, 100/10 s, 200/min par jeton ; envoi 60/min | en-têtes | — |
| Temps réel | Aucun WebSocket : le client officiel sonde, le connecteur sonde aussi | captures A, B, C | — |

**Décision** : B. Rien de ce que les captures montrent ne le bloque, et C (navigateur côté serveur) coûterait un Chromium permanent par compte (≈ 300 à 500 Mo de mémoire) pour un gain nul tant que l'API n'a pas de défense. Si V1 échoue (refus depuis un serveur, défi, jeton lié à l'appareil), on s'arrête et une ADR `proposed` chiffre C avant toute ligne de code de P2-02.

## 2. La session

**Ce que l'extension capture** (P2-01) : le jeton Bearer du membre d'équipe « bot », lu dans l'en-tête `Authorization` des requêtes que l'onglet Reveal ouvert fait à `api.reveal.me` (permission `webRequest`, écoute posée au clic sur « Synchroniser » et retirée dès la session composée, 30 s au plus ; l'onglet est rechargé une fois s'il reste muet 4 s). Le modèle vient des routes qui le nomment (`modelId=`, `/models/:id`, `/<sorte>/model/:id`), le membre de `/users/:id/…`. On n'a donc pas besoin de savoir où le tableau de bord range son jeton. L'extension lit, envoie, puis oublie : rien n'est gardé dans l'extension (ADR 0008), ni renvoyé au popup.

La session envoyée à `POST /v1/connector/sessions` (champ `session`, opaque pour le cœur) est un JSON propre à l'adaptateur, lu par un schéma Zod dans `infra/reveal/` :

```ts
{ v: 1, bearer: string, userId: string, modelId: string, userAgent: string, capturedAt: string }
```

- `userId` : le membre « bot » (sert à `notifications`, et à reconnaître nos propres messages).
- `modelId` : la créatrice du compte plateforme. Si le membre voit plusieurs modèles, l'extension demande laquelle ; un compte plateforme = une modèle.
- `userAgent` : celui du navigateur qui a capturé, rejoué tel quel (`connectors.md`, règles de bonne conduite).

**Qui envoie** : le bouton n'est proposé qu'au propriétaire, et l'envoi passe par la liaison de l'extension de VEI-01 (`x-extension-link`, jeton haché, révocable), comme le copilote, jamais par le cookie du CRM ni par un secret collé à la main (ADR 0066 § 7). Le jeton d'appareil `EXTENSION_DEVICE_TOKEN` de P0-06 est remplacé par cette liaison dans P2-01.

Le compte plateforme et la session ne font jamais apparaître le jeton ailleurs que chiffré en base (AES-256-GCM, P0-06). La route refuse une session dont `modelId` ne correspond pas au compte déjà relié : ni à la session déjà gardée, ni, dès la première « Sync », au modèle que le relevé des ventes relie à ce compte (Réglages › Relevé des ventes).

**Santé (`health`)** : `GET /models/:modelId`. 200 → `valid` ; 401 ou 403 → `expired` ; `exp` du JWT lisible : `warning` 2 h avant (le jeton ne vit que 24 h, V1).

## 3. Le client HTTP

- `undici` (déjà dans Node, pas de dépendance nouvelle), base `https://api.reveal.me` configurable (FakeReveal en test et en développement).
- En-têtes : `authorization`, `content-type: application/json` sur les écritures, `user-agent` de la session, `origin` et `referer` du tableau de bord. Rien d'autre.
- Lecture des limites à chaque réponse : quand `remaining` d'une fenêtre tombe sous 20 %, le client attend son `reset` avant l'appel suivant. 429 → `rate_limited` avec `Retry-After`.
- Erreurs : 401/403 → `session_expired`, sauf un 403 en page HTML : `fatal` « challenge » (§ 7) ; 404 → `not_found` ; 429 → `rate_limited` ; 5xx, délai dépassé, réseau → `transient` ; réponse qui ne passe pas son schéma → `fatal` « shape_changed », avec le nom de la route et le chemin Zod, jamais le corps.
- Un client par compte (résolveur de P0-06), sortie par `connector_config.egress` quand il sera codé (P2-06).
- Le jeton n'apparaît dans aucun log : le client n'écrit que la route (gabarit, sans identifiant), le statut et la durée.

## 4. Lecture

| Méthode du port | Appels Reveal | Mappage |
|---|---|---|
| `listConversations({ since, limit })` | `GET /conversations/model?filter=all&take=20`, pages suivantes tant que `lastMessage.createdAt ≥ since` | `ConversationSnapshot` : `ref` = `conversation.id` ; `fanRef` = `member.id` ; `fanDisplayName` = `memberFirstname` ou `member.userName` ; `unreadCount` = 1 si `modelIsUnread`, sinon 0 (Reveal ne donne pas de nombre) ; `lastMessageAt`, `lastMessagePreview` = `lastMessage` |
| `fetchMessages(ref, { since, limit })` | `GET /conversations/:id/messages?take=10`, pages vers le passé jusqu'à `createdAt < since` ou `hasNextPage = false` | `ExternalMessage` : `direction` = `out` si `authorMessage.memberId` est absent (message de l'équipe ou de la modèle), `in` sinon ; `media` = `medias[]` (+ `bundleWithMedias.medias`, verrouillés si `isPaid` est absent) ; `priceMinor` = `bundle.price` ; `isPaid` = `bundle.isPaid === true` ; `senderLabel` = `authorMessage.displayName` pour un sortant |
| `listTransactions({ since })` | `GET /transactions/model/:modelId?status[]=paid&status[]=refunded`, pages jusqu'à `since` | `ExternalTransaction` (la transaction ne porte ni bundle ni étape : le lien se lit à l'envers, `bundle.transactionId` d'un message) ; `kind` : `bundle` → `ppv`, `tip` → `tip`, abonnement → `subscription`, autre → `other` (énumération exacte à revoir, masquée par l'anonymiseur). Les ventes de référence restent celles de l'API CRM (ADR 0050) ; celle-ci sert au lien vente ↔ message |
| `getFanProfile(fanRef)` | `GET /conversations/:id` + `GET /conversations/:id/stats` | `FanProfile` (ADR 0018) : date d'inscription, abonnement, total dépensé, dernier paiement, carte vérifiée |
| `getFanNote(fanRef)` | `conversation.note` de `GET /conversations/:id` | lu en direct, jamais stocké (ADR 0018 § 1) |
| `getCreatorNotes(ref)` | `creatorNote` de `GET /models/:modelId` | une valeur par modèle, pas par conversation |
| `getFanPpvStats(fanRef)` | `GET /conversations/:id/ppv-history?kind=paid` (+ `free`) | taux d'achat, prix haut et bas, bundles ; `lastOfferAt` = le `createdAt` le plus récent des bundles `kind=paid` (Reveal n'a pas de champ à lui) |
| `listPlatformScripts()` | `GET /script-sequences/model/:modelId` + `GET /scripts/model/:modelId?withConversations=false` (toutes les pages) | voir § 6 |
| `getScriptHistory(fanRef)` | `GET /scripts/model/:modelId?conversationId=` (toutes les pages) | par étape : envoyée (`conversations[]` non vide), achetée (`purchased`, lu du `isPaid` de Reveal) ; ni heure d’envoi ni script parent : `stepRef` est l’id Reveal de l’étape, unique sur le compte |
| `listVaultMedia(opts)` | `GET /models/:modelId/vault-folders` + `GET /models/:modelId/medias?vaultFolderId=` | `VaultMedia` |
| `fetchMedia(ref)` | URL du média (`url` ou HLS) | hors P2-02 : la durée de validité des liens est inconnue (ouvert n° 7) |

`fanRef` → conversation : Reveal a une conversation par fan et par modèle. L'adaptateur garde la correspondance relevée par `listConversations` ; une méthode appelée avec un fan inconnu relit toute la liste, puis lève `not_found` (P2-02 : `searchParticipants` cherche un pseudo, et l'adaptateur n'a que l'id du fan).

**Notre propre message** : d'abord par son id, gardé dans `connector_sends` à l'envoi (§ 5, P2-03 : `fetchMessages` le marque `ai` et `ingestMessage` garde cet auteur) ; en repli seulement (envoi dont la réponse s'est perdue), par `authorMessage.displayName` du membre « bot » et l'empreinte. La paie, elle, lit l'auteur dans l'API CRM (ADR 0050 § 5). Le nom affiché du membre « bot » ne doit pas changer dans Reveal (`session-expired.md`). Un sortant écrit par la modèle elle-même ou par un chatteur porte un autre nom : il est sortant, mais pas le nôtre. Vers le port : `author` vaut `fan`, `ai` (le nôtre) ou `human` (P2-02). **Ouvert** : d'où vient le nom affiché du membre « bot » (la session capturée ne le porte pas) ; tant qu'il manque, seul l'id reconnaît nos messages.

**Sondage** : `connector.poll` (P0-06) appelle `listConversations(since = last_poll_at − 60 s)` puis `fetchMessages` sur chaque conversation bougée. Intervalle par défaut 60 s ± 20 s, au-dessus du client officiel (12 s) : on reste moins bavard qu'un chatteur. Latence attendue entre le message d'un fan et la réponse de l'agent : 2 à 3 minutes (relève, puis délai de frappe et de lecture).

## 5. Écriture

Toutes passent par la garde `writes` (ADR 0018 § 3) avant l'appel réseau.

| Méthode | Appel | Notes |
|---|---|---|
| `sendText` | `POST /conversations/:id/messages { message: { content, isUnread: true }, mediaIds: [], files: [] }` | |
| `sendScriptStep(ref, scriptRef, stepIndex, expectedPrice, key)` | même route, `+ scriptId` (l'étape) et le bundle de l'étape tel que `scripts.list` le donne (`bundle: { type: "media", price, mediaIds, files: [], teasingMediaIds, teasingFiles: [] }`, capture `messages.send.script`) ; une étape sans média part sans bundle | relit `getScriptHistory` juste avant : étape déjà envoyée dans cette conversation → refus définitif (ADR 0018 § 5), rendu `SendRefused` « script_step_already_sent » ; historique illisible → rien ne part. Le prix n'est jamais le nôtre : `expectedPrice` (montant en centimes et devise, `Money`) est le prix de l'étape tel que la personne ou l'agent l'a validé, comparé au prix que `scripts.list` donne juste avant ; s'il diffère (montant ou devise), rien ne part ni ne s'enregistre dans `connector_sends` (`ScriptStepPriceChanged`, rendu `SendRefused` « script_price_changed ») et l'étape se repropose à son nouveau prix |
| `sendMedia` (vocal seulement) | `mediaIds: [<audio du coffre>]` | le bot n'envoie jamais de média libre (inventaire, 17/10) ; le vocal est la seule exception : un seul média, gratuit, un audio du coffre (vérifié par `GET /models/:id/medias?mediaType=audio`), que Reveal montre comme un vocal avec lecteur (E7). L'import (`GET /medias/get-upload-url`, `PUT`, `files: [{ type: "audio", key }]`) attend un port qui porte le fichier : P2-03 ne l'a pas |
| `setFanNote(fanRef, text, key)` | `GET /conversations/:id` puis `PATCH /conversations/:id/note { note }` | remplace tout : l'adaptateur relit juste avant le `PATCH`, remplace seulement le bloc de l'agence (les lignes du canevas `<libellé> : <valeur>`, à leur place ; un libellé absent s'ajoute après la dernière ligne du canevas) et garde le reste mot pour mot ; si la note a changé entre la lecture qui a servi au texte et cette relecture (un chatteur vient d'écrire), il recompose sur la version relue, jamais sur l'ancienne. Rien n'est écrit quand la note le dit déjà, ce qui rend l'écriture idempotente sans ligne à elle ; une ligne hors canevas est refusée |
| `markRead`, `setTyping` | `PATCH /conversations/:id/read`, `POST /conversations/:id/typing` | `typing` répété toutes les 3 s pendant le délai de frappe, comme le client officiel (par l'appelant) ; `setTyping(false)` n'appelle rien : Reveal n'a pas de route pour arrêter |

**Limite d'envoi** : 60 par minute et par jeton chez Reveal (`x-ratelimit-limit`, `-remaining`, `-reset` en secondes epoch, lus par le client comme les trois autres fenêtres) ; l'adaptateur s'impose 20 par minute et par compte (au-delà : `rate_limited`, rien d'enregistré ni d'envoyé), et jamais deux envois dans la même conversation à moins de 2 s (il attend).

**Idempotence sans nonce.** Reveal n'accepte aucune clé : envoyer deux fois crée deux messages. Donc :

1. Avant l'appel, l'adaptateur enregistre la tentative dans la table `connector_sends` (migration 0177 ; clé d'idempotence unique par compte, compte, conversation, empreinte = SHA-256 du texte + `scriptId` + médias, l'étape `script_ref`, début de tentative, état `pending`), dans sa propre transaction : la ligne existe avant que Reveal soit appelé. Pour une étape, le texte n'entre pas dans l'empreinte : l'étape le nomme, et Reveal peut remplir son `%NAME%` (le fil relu n'a plus le texte envoyé).
2. Réponse reçue → la ligne prend l'id du message Reveal (`sent`).
3. Issue inconnue (délai, coupure, processus tué entre l'acceptation de Reveal et l'étape 2) → la ligne reste `pending`. `verifySent(ref, key)` relit les 20 derniers messages (`VERIFY_DEPTH`, point de vigilance : plus de 20 messages écrits dans la conversation entre la tentative et la vérification la mettraient hors de portée, et elle repartirait) et cherche un sortant (sans `memberId`, du nom du membre « bot » quand il est connu), qui n'est pas déjà un envoi à nous, avec la même empreinte, créé après le début de tentative (une minute d'écart d'horloge tolérée). Trouvé → la ligne prend son id, `sent` ; sinon `not_found`. Une clé jamais enregistrée → `not_found` (rien n'est parti).
4. Un nouvel essai avec une clé dont la ligne a déjà un id Reveal renvoie cet id sans rien envoyer. Un nouvel essai avec une clé dont la ligne est encore `pending` appelle d'abord la recherche du point 3, **avant tout nouvel envoi** : retrouvé, il garde son id et n'envoie rien ; sinon, si la tentative a moins de 30 s (`PENDING_SETTLE_MS`, compté depuis son premier début), il n'envoie rien et répond `rate_limited` avec le reste du délai (`retryAfterSeconds`) : Reveal peut lister en retard un message qu'il vient de prendre, et l'absence dans le fil ne prouve rien si tôt ; passé ce délai, il envoie, la ligne gardant son premier début de tentative (un second essai perdu repart donc sans attendre). Une tentative que Reveal a refusée (429, 5xx) attend aussi ce délai : la ligne ne dit pas si le message a été pris. Une clé reprise pour une autre empreinte ou une autre conversation est refusée (`fatal`). FakeReveal joue « envoi accepté puis coupure » (`send_answer_lost`) et « message listé en retard » (`send_listed_late`), et les tests jouent le processus tué avant l'étape 2 : aucun doublon.

## 6. Scripts

Dans l'API, un « script » est **une étape** ; une **séquence** les ordonne. Vers le port (`PlatformScript`, ADR 0018) :

- une séquence → un `PlatformScript`, ses étapes dans l'ordre de `stepIndex` ;
- une étape hors de toute séquence → un `PlatformScript` d'une seule étape ;
- prix : `script.price` en centimes TTC, absent = gratuit ;
- moment : `day` si le nom de la séquence (ou, à défaut, du dossier du coffre de ses médias vendus, quand ces dossiers s'accordent) contient ☀️, `night` s'il contient 🌙, sinon `null` ; un nom qui porte les deux donne `null` ; le coffre n'est lu que si un nom ne dit rien ;
- `stepIndex` du port → l'id de l'étape Reveal, résolu par l'adaptateur.

« Déjà envoyée » se lit par étape et par conversation (`conversations[]` de `scripts.list?conversationId=`), avec l'état d'achat : c'est la seule source (ADR 0018 § 5).

## 7. Risques et signaux de détection

| Signal | Où on le voit | Réaction |
|---|---|---|
| 401/403 soudains | `health`, toute route | session expirée : arrêt total, alerte, re-sync par le bouton (`session-expired.md`) |
| 429 ou `remaining` qui baisse plus vite que nos appels | en-têtes | ralentir ; si 429 malgré nos marges : un autre client tourne sur le même jeton, alerte |
| Réponse qui ne passe plus son schéma | client | `fatal` « shape_changed », coupe-circuit, alerte ; nouvelle capture et diff (P1-01) |
| Défi, page HTML, Cloudflare sur `api.reveal.me` | client | arrêt, alerte : c'est le cas où l'ADR C s'écrit |
| Membre « bot » déconnecté quand Charles ouvre son compte ailleurs | 401 après une connexion | ne jamais ouvrir le membre « bot » sur un autre appareil (runbook) |
| Message envoyé qui n'apparaît pas dans le fil | `verifySent` | pas de renvoi automatique, alerte |

**Changements d'API** : l'enregistreur de l'extension (P1-01) ou une capture HAR anonymisée (`reveal-capture-express.md`) refait les enregistrements ; `fidelity.test.ts` échoue sur toute forme qui a changé ; on corrige les schémas, FakeReveal et ce document dans la même PR, et on ajoute une ligne au journal de `reveal-api-observed.md`.

## 8. Découpage de la phase 2

| Fiche | Contenu | Dépend de |
|---|---|---|
| P2-01 | Capture de session (bouton Sync de l'extension), V1 et V2 en lecture seule à la demande de Charles, aide `/aide/reveal` | P1-03 |
| P2-02 | `RevealApiConnector` en lecture, méthodes de lecture de l'ADR 0018, contrat vert contre FakeReveal | P2-01 (V1) |
| P2-03 | Écritures : texte, étape de script, note, vocal ; `connector_sends` ; limite 60/min dans FakeReveal | P2-02 |
| P2-04 | Réconciliation : envois non retrouvés, lien vente ↔ message, historique complet à l'import | P2-02 |
| P2-05 | Runbooks testés sur le compte de test (fan « test ») : session expirée, re-sync, coupe-circuit, kill switch | P2-03 |
| P2-06 | Déploiement : serveur, IP française de sortie (`egress`), secrets, sauvegardes | P2-05 |
