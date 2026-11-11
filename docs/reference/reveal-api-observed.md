# Reveal : API privée observée

**Statut : rempli le 2026-11-10 (P1-02)** à partir de trois captures HAR anonymisées du même jour, faites par Charles avec le chatteur « bot » et le fan test (`docs/runbooks/reveal-capture-express.md`). Fichier protégé (`hygiene.md`) : il se complète, il ne se supprime pas.

Sources :

| Capture | Heure (UTC) | Contenu |
|---|---|---|
| A (`reveal-2026-11-09-a`, enregistrée le 10/11) | 14:04–14:37 | 4 785 requêtes, sans corps de réponse sur les routes clés : routes, en-têtes, rythme du client |
| B (`reveal-2026-11-10-a`) | 17:28–17:30 | 690 requêtes avec corps : liste, conversation, envoi d'un texte et d'un bundle, achat du bundle par le fan test |
| C (`reveal-2026-11-10-b`) | 17:35–17:37 | 683 requêtes avec corps : scripts, sélecteur de scripts, coffre, envoi d'une étape de script et d'un vocal |

Les réponses découpées sont dans `apps/api/src/__tests__/fake-reveal/recordings/2026-11-10/` (une par route, tableaux réduits à deux éléments, textes, liens, codes et montants de l'agence remplacés par des valeurs inventées) ; les en-têtes dans `recordings/2026-11-10/headers.md`. Les captures elles-mêmes restent sur le PC de Charles (`.scratch`, ignoré par git). FakeReveal suit ces formes, et `fidelity.test.ts` vérifie chaque enregistrement contre son schéma.

## Résumé : les 14 questions

1. **Style, base URL** : REST JSON sur `https://api.reveal.me`, sans préfixe de version. Le tableau de bord (`https://dashboard.reveal.me`) l'appelle en CORS. ETag faible (`W/"…"`) et 304 sur `if-none-match`.
2. **Temps réel** : **aucun WebSocket** (0 trame dans les trois captures). Le client officiel sonde : messages de la conversation ouverte toutes les ~11,5 s, « en train d'écrire » toutes les 3,5 s, liste des conversations toutes les ~11,8 s, compteurs toutes les ~16,3 s, notifications avec `since`. Un achat apparaît dans le fil au sondage suivant (~18 s après le paiement dans la capture B). → `realtime: false`, le connecteur sonde.
3. **Non-lus et dernier message sans ouvrir** : oui. Chaque élément de `GET /conversations/model` porte `conversation.modelIsUnread`, `lastMessage` (texte, date), `lastMessageAuthor`, `lastMessageHasMedia`, `memberTotalSpent`, `memberLastSeenAt`, la note client (`conversation.note`), le prénom (`memberFirstname`) et la note du modèle (`modelCreatorNote`). Compteur : `GET /conversations/model/count?isUnread=true`. → `unreadWithoutOpen: true`.
4. **Identifiants** : UUID pour tout (modèle, membre, conversation, message, bundle, script, média, transaction). Stables entre les captures B et C (même conversation, mêmes étapes de script). Un message de l'équipe ne porte que le nom affiché de son auteur, aucun identifiant de membre.
5. **Authentification** : en-tête `authorization: Bearer <jeton>`, aucun cookie vers l'API. L'export « sanitized » retire la valeur : forme du jeton et durée de vie **inconnues**. La réponse à une session invalide **n'a pas été capturée** (L1 ouvert).
6. **Écritures** : JSON simple, **ni CSRF, ni signature, ni nonce, ni clé d'idempotence**. Envoyer deux fois crée deux messages : le connecteur relit le fil (`verifySent`) avant tout renvoi.
7. **Anti-bot** : aucun sur `api.reveal.me` (pas de Cloudflare, Turnstile ni défi). Un script de protection tourne sur le tableau de bord seulement.
8. **Ventes PPV** : un bundle acheté passe à `bundle.isPaid: true` avec un `transactionId` dans le fil ; la transaction apparaît dans `GET /transactions/model/:id` ; une notification arrive (`GET /users/:id/notifications?since=`). L'API CRM officielle (clé `x-api-key`) donne aussi chaque vente. → `transactions: true`.
9. **Envoi de média** : depuis le coffre par `mediaIds`, ou en important : `GET /medias/get-upload-url?name&type&size` renvoie une URL présignée en texte brut, le client y fait un `PUT`, puis envoie `files: [{ type, key }]`. Vidéos du coffre en HLS (Bunny, AES-128). Limites de taille non vues. → `sendMedia: true`.
10. **Limites de débit** : sur chaque réponse, trois fenêtres : 50 par seconde, 100 par 10 s, 200 par minute (`x-ratelimit-limit-short|medium|long`, `-remaining-`, `-reset-`). En plus, l'envoi `POST /conversations/:id/messages` est limité à 60 par minute (`x-ratelimit-limit: 60`). `Retry-After` est exposé ; aucun 429 n'a été observé.
11. **Scripts natifs** : un « script » de l'API est **une étape** (texte, médias vendus, aperçu, prix facultatif) ; une **séquence** les met en ordre (`/script-sequences`). `GET /scripts/model/:id?conversationId=` ajoute à chaque étape `conversations: [{ id, hasBundle, isPaid }]`, rempli seulement si l'étape a **déjà été envoyée dans cette conversation** : c'est l'indicateur « déjà envoyé » (L9), par étape et par conversation, avec l'état d'achat. L'envoi n'a pas de route dédiée : c'est l'envoi ordinaire avec `scriptId`.
12. **Historique** : messages paginés du plus récent au plus ancien par curseur (`cursor` = `pageInfo.endCursor` = id du dernier élément) avec `totalCount`. Le premier message n'a pas été atteint (20 pages remontées). Achats par `ppv-history` (paginé) et `/transactions`. Note client : une valeur par conversation, dans la liste.
13. **Notes client** : `conversation.note`, un texte libre par conversation, lu dans la liste et `GET /conversations/:id`, écrit par `PATCH /conversations/:id/note { note }` qui remplace tout et renvoie la conversation. Aucun numéro de version : le dernier qui écrit gagne. Le connecteur relit juste avant d'écrire et n'écrit que ses lignes (canevas de l'agence).
14. **Âge des fans** : **aucun champ d'âge**. Seul `member.cardVerifiedAt` dit qu'une carte a été vérifiée, et la modèle peut l'exiger (`requireCardVerificationForFreeSubscription`). L'âge reste un sujet du KYC et des gardes, pas une donnée de Reveal.

**Notes du modèle (L11)** : `creatorNote` de `GET /models/:id`, une valeur par modèle, recopiée dans chaque conversation (`modelCreatorNote`). Écriture non observée.

**Vocal (E7)** : le bouton micro envoie un fichier importé `files: [{ type: "audio", key }]` hors bundle. Un audio rangé dans le coffre puis envoyé s'affiche chez le fan comme un vrai vocal avec lecteur (Charles, 10/11).

**Capacités déclarées** (`ConnectorCapabilities`, constante `REVEAL_EXPECTED_CAPABILITIES` de FakeReveal) : `unreadWithoutOpen`, `sendMedia`, `transactions`, `markRead`, `typing` à `true` ; `realtime` à `false`.

## En-têtes

Requête : `authorization: Bearer …`, `content-type: application/json`, `origin`/`referer` du tableau de bord, `if-none-match` facultatif. Aucun en-tête maison. Réponse : `x-request-id`, `etag`, les limites de débit ci-dessus, `access-control-expose-headers: Retry-After,Server-Timing,X-Request-Id`. Détail : `recordings/2026-11-10/headers.md`.

## Pagination

Toutes les listes paginées répondent `{ data, pageInfo: { hasNextPage, endCursor }, totalCount? }`. Le curseur de la page suivante est l'id du dernier élément (`endCursor`), passé en `cursor` ; `take` fixe la taille (20 pour les conversations et les scripts, 10 pour les messages, l'historique PPV et le coffre, 5 pour les notifications dans le client). Ordres observés : conversations par `lastMessageAt` décroissant, messages du plus récent au plus ancien, scripts par `updatedAt` croissant, transactions et notifications du plus récent au plus ancien.

## Endpoints

Chaque ligne a son enregistrement (`recordings/2026-11-10/<nom>.2026-11-10.json`) et sa route FakeReveal (nom entre crochets = clé de `ENDPOINTS`).

### Lecture

| Route | Paramètres | Réponse (champs utiles) | Capacité |
|---|---|---|---|
| `GET /conversations/model` [`conversations.list`] | `take`, `cursor`, `modelId`, `filter` ∈ `all`, `pinned`, `priority`, `unread`, `online`, `searchParticipants`, `listId` | `data[]` de `{ conversation, lastMessage, lastMessageAuthor, lastMessageHasMedia, member, model, memberTotalSpent, memberLastSeenAt, modelCreatorNote, isExcludedFromMassDM }`, `pageInfo` | L2 |
| `GET /conversations/model/count` [`conversations.count`] | `modelId`, `isUnread=true` ou `filter` ∈ `priority`, `pinned`, `online` | `{ count }` | L2 |
| `GET /conversations/:id` [`conversations.get`] | | même élément que la liste | L2, L5 |
| `GET /conversations/:id/messages` [`messages.list`] | `take`, `cursor` | `data[]` de `{ message: { id, bundleId?, createdAt, isUnread, content, type }, medias[], bundleWithMedias?: { bundle: { id, price, type, isPaid?, transactionId?, memberId }, medias[], teasingMedia?, teasingMedias[] }, authorMessage: { displayName, memberId? }, reactions, replyTo, storyReply }`, `pageInfo`, `totalCount`, `memberLastReadAt` | L3 |
| `GET /conversations/:id/ppv-history` [`conversations.ppvHistory`] | `take`, `cursor`, `kind` ∈ `paid`, `free` | `{ buyRate: { purchased, total, percentage }, highestPrice, lowestPrice, bundles[]: { id, price, isPaid, createdAt, massDMId, medias[] }, pageInfo }` ; `percentage = Math.round(purchased / total × 100)`, 0 si aucun | L13 |
| `GET /conversations/:id/stats` [`conversations.stats`] | | `{ memberCreatedAt, firstSubscriptionAt, tipsTotal, messagesTotal, totalSpent, boudoirItemTotal, incomingMessageTotal, lastPaidAt, highestPurchase, subscriptionPeriodicity, subscriptionExpireAt, autoRenew, buyingRate, paidMediaRates }` | L5, L12 |
| `GET /conversations/:id/typing` [`conversations.typing.get`] | | `{ isTyping }` | E6 |
| `GET /models/:id` [`models.get`] | | profil de la modèle, dont `creatorNote` (note du modèle), message de bienvenue, rappel d'expiration | L1, L11 |
| `GET /scripts/model/:id` [`scripts.list`] | `take`, `cursor`, `search`, `conversationId` ou `withConversations=false` | `data[]` de `{ script: { id, name, content, price? }, medias[], teasingMedias[], tags[], conversations[]: { id, hasBundle, isPaid } }` ; sans conversation : `sentCount`, `paidBundlesCount`, `paidBundlesTotalAmount` ; `totalCount` | L8, L9 |
| `GET /script-sequences/model/:id` [`scriptSequences.list`] | | `[]` de `{ sequence: { id, name }, steps[]: { step: { id, stepIndex }, script, medias, teasingMedias, tags } }`, sans pagination | L8 |
| `GET /models/:id/vault-folders` [`vault.folders`] | | `[]` de `{ id, name, imageCount, videoCount, mediaUrl, isSharedForSfs }`, sans pagination | L10 |
| `GET /models/:id/medias` [`vault.medias`] | `take`, `cursor`, `vaultFolderId`, `mediaType`, `memberId` | médias du coffre + `status[]` relatif au membre (`paid`), `sentForFree`, `description`, `suggestedMinPrice`, `suggestedMaxPrice` ; `totalImage`, `totalVideo` | L10 |
| `GET /transactions/model/:id` [`transactions.list`] | `take`, `cursor`, `status[]` ∈ `paid`, `refunded`, `refund_asked` | `data[]` : `amount`, `status`, `type`, `memberId`, `agencyMemberId`, répartition (TVA, Reveal 18 %, agence, modèle), `countryCode` | L6 |
| `GET /users/:id/notifications` [`notifications.list`] | `take`, `since`, `cursor` | `data[]` : `type`, `title`, `content`, `conversationId`, `isRead` | L4 |

Un média (`medias[]`) porte `id`, `type` ∈ `photo`, `video`, `audio`, `url`, `smallUrl`, `mediumUrl`, `largeUrl`, `blurhash`, `durationSeconds`, `name`, `isArchived`, `modelId` ; un média du coffre ajoute `isHls`, `thumbnailUrl`, `moderationStatus` ; un fichier envoyé par le fan ajoute `incomingMessageMemberId` (et n'a pas les trois précédents).

### Écriture

| Route | Corps | Réponse | Capacité |
|---|---|---|---|
| `POST /conversations/:id/messages` [`messages.send`] | texte : `{ message: { content, isUnread }, mediaIds: [], files: [] }` ; bundle : `+ bundle: { type: "media", price, mediaIds, files, teasingMediaIds?, teasingFiles? }` ; étape de script : `+ scriptId` ; vocal : `files: [{ type: "audio", key }]` | `{ id, bundleId?, createdAt, updatedAt, isUnread, content, type }` | E1, E2, E3, E7 |
| `PATCH /conversations/:id/read` [`conversations.read`] | aucun | la conversation | E6 |
| `POST /conversations/:id/typing` [`conversations.typing`] | aucun | `{ success }` | E6 |
| `PATCH /conversations/:id/note` [`conversations.note`] | `{ note }` | la conversation | E4 |
| `GET /medias/get-upload-url` [`media.uploadUrl`] | `name`, `type`, `size` en query | URL présignée en texte brut (`text/html`) ; puis `PUT` du fichier dessus | E7 |

Prix en centimes TTC (`price: 300` = 3 €).

### Non utilisés (vus pendant la capture, jamais appelés par le connecteur)

`POST /scripts` (création d'étape), `POST /script-sequences`, `PUT /script-sequences/:id/steps`, `DELETE /script-sequences/:id`, `POST` et `DELETE /models/:id/vault-folders`, `POST /media`, `DELETE /media/:id`. Et `GET /billing-info/agency/:id`, qui renvoie l'IBAN, le SIRET et l'adresse de l'agence : **jamais appelé, jamais enregistré**.

## Ce qui reste ouvert

1. Réponse à une session invalide ou expirée (L1), et durée de vie du jeton.
2. Premier message d'une conversation (fin de pagination) et types de messages autres que `default` (tip, système, Mass DM, supprimé).
3. Valeurs de `notifications[].type`, `transactions[].type` et `subscriptionPeriodicity` : masquées par l'anonymiseur, qui doit les garder en clair (énumérations) à la prochaine capture.
4. Qui remplace `%NAME%` (le tableau de bord ou Reveal) : contenu masqué ; l'anonymiseur doit signaler sa présence sans le texte.
5. Forme des étapes d'une séquence remplie (la séquence capturée était vide).
6. Bornes de prix et du nombre de médias d'un bundle, codes d'erreur (aucun 4xx observé).
7. Durée de validité des liens de médias (L14) et téléchargement des originaux (L15).
8. Stabilité sur deux jours différents : les trois captures sont du même jour.

## Juridique

Lu le 2026-11-11 (P1-03) sur les pages publiques : `https://reveal.me/cgu` (« CGU / CGV », version 3, en vigueur au 25/07/2026), la politique anti-spam (en vigueur au 07/10/2026) et les pages `crm`, `agences`, `anonymat`. Le texte des CGU lu s'arrête dans l'article 10b.8 : les articles 11 à 13 (dont 12.5, cité par 6.3.3) **restent à lire**. Résumé, pas un avis juridique.

| Sujet | Ce que disent les textes | Pour nous |
|---|---|---|
| Agence qui écrit pour la créatrice | Art. 5.1 et 5.3 : une « Agence Partenaire mandatée par le Créateur » gère le profil et « est autorisé[e] à échanger via le Chat avec l'Utilisateur au nom et pour le compte du Créateur » | L'agence écrit légitimement ; le membre « bot » est un membre de l'équipe de l'agence |
| Logiciel tiers, rétro-ingénierie | Art. 9 : interdit d'« utiliser tout logiciel activant ou comprenant tout ou partie de la Plateforme », de la « décompiler, désosser », de « tenter de découvrir tout code source » | **Le risque principal** : un client qui appelle l'API privée peut être lu comme un tel logiciel. Rien ne vise expressément les API, les robots ou le scraping |
| Envois en masse, robots | Art. 9 et anti-spam : interdits les messages « envoyés en masse » non sollicités et les « comptes automatisés ou robots » pour promouvoir un profil | Vise la prospection hors de Reveal ; l'agent ne répond qu'à des fans abonnés, un par un, au rythme d'un chatteur |
| IA | Art. 10 bis : contenus IA reproduisant une personne réelle sans son autorisation interdits (deepfakes), et tout contenu IA sexuel représentant un mineur | Rien sur une IA qui converse ni sur une information des fans. La voix clonée exige l'autorisation écrite de la créatrice |
| Identifiants | Art. 4.2 : « personnels et confidentiels » ; pages `crm` et `anonymat` : chaque membre a son accès, sans partager le compte de la créatrice | Le membre « bot » a son propre accès : on ne partage pas le compte de Messa |
| Sanctions | Art. 9 : suspension « à son entière discrétion », « sans préavis », temporaire ou définitive ; anti-spam : gains du trafic de spam retenus | Le pire cas est la suspension du compte de la créatrice : d'où le rythme humain, le coupe-circuit et le kill switch |

**Décision de Charles** (2026-11-11, fil Bilan, carte « Continuer le connecteur Reveal par leur API privée, malgré l'article 9 des CGU ? ») : **continuer**. Parades : membre « bot » à part, rythme humain, coupe-circuit, kill switch, aucune écriture réelle sans son accord.

## Journal des changements observés

| Date | Changement | Impact | Action |
|---|---|---|---|
| 2026-11-10 | Première lecture (captures A, B, C) | Routes de FakeReveal réécrites sur les vraies | P1-02 |
