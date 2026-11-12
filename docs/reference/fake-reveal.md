# FakeReveal : spécification

Dernière revue : 2026-11-10. Statut : **codé sur les routes observées**. Le serveur, l'état, les scénarios et le test de fidélité existent (`apps/api/src/__tests__/fake-reveal/`). Les chemins, paramètres, ordres et formes de réponse suivent `docs/reference/reveal-api-observed.md`, rempli à partir des captures anonymisées du 10/11 ; chaque route a son enregistrement dans `recordings/2026-11-10/`. Ce que les captures n'ont pas montré est marqué « PROVISIONAL » dans `server.ts` : réponse d'erreur et de session invalide, liens de fichiers, clé d'import, types de notification, remplacement de `%NAME%`. Ce document fixe ce que FakeReveal doit savoir simuler, aligné sur `docs/reference/reveal-connector-inventory.md`.

## Rôle

Un serveur Fastify dans `apps/api/src/__tests__/fake-reveal/` qui imite l'API privée de Reveal. Il sert :

- au **test de contrat** du connecteur : la même suite tourne contre `FakeConnector` et contre `RevealApiConnector` pointé sur FakeReveal (`docs/conventions/testing.md`) ;
- aux tests du **moteur de vente** : scripts natifs, étapes déjà envoyées, achats ;
- au développement local et aux e2e de l'extension, sans compte Reveal.

## État en mémoire

Tout est inventé et évidemment faux (pseudos `fan_test_01`, textes « Message de test 3 »). Montants en centimes, identifiants opaques de la même forme que ceux de Reveal (longueur, préfixe, numérique ou non : d'après la capture).

| Entité | Champs |
|---|---|
| Compte créatrice | `ref`, pseudo, devise |
| Session | `valid`, `expiresAt`, compteur d'appels (rate limit) |
| Fan | `ref`, pseudo, `subscribedAt`, statut d'abonnement, `totalSpentCents`, listes ou étiquettes, âge vérifié (si Reveal l'expose) |
| Conversation | `ref`, `fanRef`, `unreadCount`, `lastMessageAt`, messages |
| Message | `ref`, `direction`, texte, médias joints (photo, vidéo, vocal), bundle facultatif (médias vendus, aperçu ≤ 10, prix TTC, `paidAt`, `transactionId`), `createdAt`, nom affiché de l'auteur côté équipe, `scriptId` si envoyé depuis une étape. Les types tip, système, masse et supprimé n'ont pas encore été vus |
| Note client | un texte libre par conversation (`conversation.note`), remplacé en entier ; prénom du membre (`memberFirstname`, source de `%NAME%`) |
| Note du modèle | une par modèle (`creatorNote`), recopiée dans chaque conversation |
| Statistiques PPV | dérivées des messages PPV et des transactions du fan, avec les champs de l'onglet PPV |
| Média du coffre | `ref`, `kind` (photo, vidéo, audio), dossier |
| Script natif | une **étape** pour Reveal : `ref`, nom, texte avec `%NAME%` possible, médias vendus, aperçu, prix facultatif |
| Séquence | nom, étapes dans l'ordre |
| Envoi de script | le message porte `scriptId` ; l'indicateur « déjà envoyé » se calcule par conversation à partir des messages |
| Transaction | `ref`, `fanRef`, type (PPV, tip, abonnement), `amountCents`, `messageRef`, `createdAt` |

Fixtures de départ (`fixtures.ts`, `default`, `empty` et `quiet`, deux fans et leurs conversations sans message, pour le test de contrat) : 1 créatrice, 12 fans dont 3 payeurs et 1 sans aucun message, 1 conversation de 320 messages (pagination), 15 médias en 3 dossiers du coffre, 4 séquences de 3 étapes aux prix 5, 15 et 30 €, dont 1 envoyée en entière à un fan (2 étapes achetées) et 1 envoyée jusqu'à l'étape 2 à un autre.

## Comportements

| Capacité | Ce que FakeReveal reproduit |
|---|---|
| L1 | Réponse de démarrage ; 401 ou redirection de connexion (forme observée) quand la session est invalide |
| L2 | Pagination et tri observés ; non-lus et aperçu ; filtres |
| L3 | Pagination vers le passé jusqu'au premier message ; tous les types de messages ; PPV verrouillé ou acheté |
| L4 | Pas de WebSocket (comme Reveal) : un nouveau message ou un achat se voit au sondage suivant, et une notification est créée |
| L5, L6 | Profil, total dépensé et transactions cohérents avec les messages achetés |
| L7, E4 | Lecture et écriture de la note ; écriture concurrente (un « chatteur » écrit entre la lecture et l'écriture du connecteur) selon la sémantique observée |
| L11, L13 | Notes du modèle ; onglet PPV calculé à partir de l'état (jamais stocké à part, pour rester cohérent) |
| L8 | Liste et contenu des scripts, dossiers |
| L9, E3 | Indicateur « déjà envoyé » par fan, sous la forme observée, mis à jour à chaque envoi d'étape (par l'agent ou par un chatteur) |
| L10 | Coffre paginé |
| L14 | Sert de vrais fichiers de test (image et vidéo minuscules, générées) derrière des URL signées qui expirent ; une URL expirée répond comme Reveal |
| E1, E2 | Envoi : nouvel identifiant, message visible à la relecture ; bornes de prix (rejet hors bornes, code observé) ; bundle refusé sans média vendu ou avec plus de 10 médias d'aperçu ; `%NAME%` remplacé par le prénom du membre |
| E5 | Reveal ne prend pas de nonce : un envoi rejoué crée un doublon, et `verifySent` doit l'éviter en amont |
| E6 | Accepte `markRead` et la frappe, remet `unreadCount` à zéro |

## Scénarios pilotables

API de contrôle, absente du vrai Reveal, préfixée `/__` :

- `POST /__reset` : recharge les fixtures (`?fixture=<nom>`).
- `GET /__state` : état complet, pour les assertions.
- `POST /__scenario` : programme des événements (`{ events: [...] }`), à `atMs` après l'horloge de FakeReveal.
- `POST /__clock` : avance l'horloge (`{ advanceMs }`) ; les événements échus se produisent. Seule cette route fait passer le temps, un test reste déterministe.

| Événement | Effet |
|---|---|
| `fan_message` (t+X, fan, texte) | Nouveau message entrant, non-lus +1, événement temps réel |
| `purchase` (t+X, message PPV) | Achat : `unlockedAt`, transaction, total du fan, événement temps réel |
| `session_expired` | Toutes les requêtes répondent comme Reveal le fait pour une session expirée |
| `rate_limited` (n requêtes, `Retry-After`) | 429 ou le code observé |
| `server_error` (n fois, code) | 500, 502, 503 |
| `latency` (ms, plage) | Délai sur chaque réponse |
| `conversation_gone` | La conversation disparaît (fan désabonné, bloqué ou supprimé) |
| `script_changed` | Un script change d'étapes ou de prix entre deux lectures |
| `shape_changed` | Un champ renommé ou ajouté dans une réponse : le connecteur doit lever une erreur typée, pas avaler la donnée (schémas Zod stricts aux frontières) |
| `challenge` | Page anti-bot (403 avec HTML) à la place du JSON |

## API CRM (ADR 0050 § 9)

`apps/api/src/__tests__/fake-reveal/crm.ts` sert les huit routes de la documentation « CRM / API » de Reveal (relue le 06/11/2026) : `/v1/stats/daily`, `/v1/models`, `/v1/chatters`, `/v1/stats/chatters/daily`, `/v1/tracking-links`, `/v1/stats/tracking-links/daily` (liens inventés dans `crm-tracking.ts`), `/v1/sales`, et les webhooks (`POST`, `GET`, `PATCH`, `DELETE /v1/webhooks`, leurs envois et leur relance), derrière `x-api-key`, sur un registre en mémoire, par `app.inject` (aucun port ouvert). Les erreurs suivent la documentation : 400 (dates, plus de 31 jours, curseur, `take` au-delà de 500, adresse de webhook), 401, 403 (accès, périmètre de la clé, 10 webhooks), 404 (webhook ou envoi inconnu ou d'une autre clé), 409 (relance refusée), 429 avec `Retry-After`. `statsFromRegister()` fait calculer les statistiques depuis le registre (jour de la vente à Paris, jours à venir omis, remboursement retranché du jour de sa vente, chaque vente dans sa colonne nette) ; sans lui, elles rendent le jour fixe que les autres tests lisent. Une vente se lit au statut du moment de la lecture (`refunded` une fois remboursée). Tout est inventé (`model_test_01`, `chatter_test_01`, `fan_test_01`). `crm-doc.test.ts` tient FakeReveal à la documentation.

Options : `now` (horloge), `limits` (limites de débit comptées : statistiques 10 par minute par clé, 20 par minute et 500 par jour pour l'agence, 200 par minute pour toutes les routes), `allowLoopbackHttp` (webhook en `http://127.0.0.1`, bac à sable seulement), `deliver` (envoie réellement les livraisons, `pumpDeliveries`).

Commandes : `sell` (vente ajoutée au registre dans son ordre, quelle que soit sa date : une vente 3-D Secure confirmée tard vient en dernier), `refund`, `appendRaw` (événement inconnu), `rateLimit` (429 et `Retry-After`), `revoke` (401), `restore`, `withhold` (403 sur les ventes, les statistiques ou les webhooks), `limitTo` (clé limitée à des modèles), `setNightlyDone` (compteurs de messages `null` avant la nuit de calcul), `setCountTimeout`, `breakShape` (réponse sans `pageInfo`), `positionOf`, `calls`, `webhooks`, `deliveries`, `setWebhookOutage` (ventes sans envoi), `duplicateNext`, `failNext`, `setShuffle`, `pumpDeliveries` (envois dus : 15 s après la vente, puis 30 s, 1 min, 2 min… une heure au plus, 8 essais), `delivery` (la livraison qu'enverrait Reveal pour une ligne du registre, signée avec le secret du webhook ; secret, `t` et id remplaçables pour en forger une), `revealSignature`.

Le bac à sable de recette (ADR 0075, `docs/recette/bac-a-sable.md`) le sert sur la machine par `pnpm sandbox:world`, avec les limites, l'horloge avançable et l'envoi réel des webhooks à l'API locale.

## Fidélité

- Les formes servies sont celles du connecteur (`connectors/infra/reveal/wire.ts`, `REVEAL_ENDPOINTS`), une seule copie : FakeReveal et `RevealApiConnector` ne peuvent pas diverger. `createFakeReveal().fetch` sert le connecteur par `app.inject`, sans port ouvert (P2-02).
- Chaque endpoint de FakeReveal cite sa section de `reveal-api-observed.md` et la date de la capture qui le fonde.
- Les captures anonymisées retenues comme référence sont copiées dans `apps/api/src/__tests__/fake-reveal/recordings/` (sans secret ni donnée réelle, relues avant commit, gitleaks), et un test vérifie que les réponses de FakeReveal passent les mêmes schémas Zod que ces enregistrements.
- Quand une nouvelle capture montre un changement, FakeReveal et le journal des changements de `reveal-api-observed.md` sont mis à jour dans la même PR.

## Hors périmètre

Paiement réel, anti-bot réaliste au-delà du scénario `challenge`, interface web de Reveal.
