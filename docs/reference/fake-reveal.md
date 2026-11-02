# FakeReveal : spécification

Dernière revue : 2026-10-27. Statut : **codé, routes provisoires**. Le serveur, l'état, les scénarios et le test de fidélité existent (`apps/api/src/__tests__/fake-reveal/`). Les chemins et les formes de réponse sous `/api` sont **inventés** tant qu'aucune capture n'existe (`model.ts`, `OBSERVED_ON` vide) ; ils seront réécrits d'après `docs/reference/reveal-api-observed.md`, rempli à partir des captures anonymisées (`docs/runbooks/reveal-recording.md`). Ce document fixe ce que FakeReveal doit savoir simuler, aligné sur `docs/reference/reveal-connector-inventory.md`.

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
| Message | `ref`, `direction`, `kind` (texte, média, bundle, vocal, tip, système, masse), texte, `lockedMediaRefs`, `teaserMediaRefs` (≤ 10), `priceCents` TTC, `discountedPriceCents?`, `unlockedAt`, `createdAt`, auteur côté équipe (membre), `deletedAt?` (visible des admins seulement), nonce client, `scriptRef` et `stepIndex` si envoyé par script |
| Note client | `fanRef`, texte, `updatedAt` ; canevas du compte (lignes « Clé : ») ; prénom du membre (source de `%NAME%`) |
| Notes du modèle | portée (compte ou conversation, d'après la capture), texte, `updatedAt` |
| Statistiques PPV | dérivées des messages PPV et des transactions du fan, avec les champs de l'onglet PPV |
| Média du coffre | `ref`, `kind` (photo, vidéo, audio), dossier |
| Script natif | `ref`, nom, dossier, étapes (nom, texte avec `%NAME%` possible, `mediaRefs`, `priceCents` ou gratuit, délai) |
| Envoi de script | `fanRef`, `scriptRef`, `stepIndex`, `messageRef`, `sentAt` |
| Transaction | `ref`, `fanRef`, type (PPV, tip, abonnement), `amountCents`, `messageRef`, `createdAt` |

Fixtures de départ (`fixtures.ts`, `default` et `empty`) : 1 créatrice, 12 fans dont 3 payeurs et 1 sans aucun message, 1 conversation de plus de 300 messages (pagination), 15 médias en 3 dossiers, 4 scripts de 3 étapes aux prix 5, 15 et 30 $, dont 1 déjà envoyé en entier à un fan et 1 envoyé jusqu'à l'étape 2 à un autre.

## Comportements

| Capacité | Ce que FakeReveal reproduit |
|---|---|
| L1 | Réponse de démarrage ; 401 ou redirection de connexion (forme observée) quand la session est invalide |
| L2 | Pagination et tri observés ; non-lus et aperçu ; filtres |
| L3 | Pagination vers le passé jusqu'au premier message ; tous les types de messages ; PPV verrouillé ou acheté |
| L4 | Même mécanisme que Reveal (WebSocket ou polling) ; événements « nouveau message » et « achat » |
| L5, L6 | Profil, total dépensé et transactions cohérents avec les messages achetés |
| L7, E4 | Lecture et écriture de la note ; écriture concurrente (un « chatteur » écrit entre la lecture et l'écriture du connecteur) selon la sémantique observée |
| L11, L13 | Notes du modèle ; onglet PPV calculé à partir de l'état (jamais stocké à part, pour rester cohérent) |
| L8 | Liste et contenu des scripts, dossiers |
| L9, E3 | Indicateur « déjà envoyé » par fan, sous la forme observée, mis à jour à chaque envoi d'étape (par l'agent ou par un chatteur) |
| L10 | Coffre paginé |
| L14 | Sert de vrais fichiers de test (image et vidéo minuscules, générées) derrière des URL signées qui expirent ; une URL expirée répond comme Reveal |
| E1, E2 | Envoi : nouvel identifiant, message visible à la relecture ; bornes de prix (rejet hors bornes, code observé) ; bundle refusé sans média vendu ou avec plus de 10 médias d'aperçu ; `%NAME%` remplacé par le prénom du membre |
| E5 | Un envoi rejoué avec le même nonce ne crée pas de doublon si Reveal le garantit ; sinon le doublon apparaît et `verifySent` doit l'éviter en amont |
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
| `ws_drop` | Coupure du temps réel ; le connecteur reprend par polling (pas encore codé : la capture dira si Reveal a du temps réel) |

## API CRM (ADR 0050 § 9)

`apps/api/src/__tests__/fake-reveal/crm.ts` sert les routes documentées de `api.reveal.me` (`/v1/sales`, `/v1/models`, `/v1/chatters`, `/v1/stats/daily`, `/v1/stats/chatters/daily`, `POST /v1/webhooks`, `DELETE /v1/webhooks/:id`) derrière `x-api-key`, sur un registre en mémoire, par `app.inject` (aucun port ouvert). Tout est inventé (`model_test_01`, `chatter_test_01`, `fan_test_01`) ; les formes suivent la documentation lue le 02/11/2026 tant qu'aucune réponse réelle n'a été vue.

Commandes : `sell` (vente ajoutée au registre dans son ordre, quelle que soit sa date : une vente 3-D Secure confirmée tard vient en dernier), `refund`, `appendRaw` (événement inconnu), `rateLimit` (429 et `Retry-After`), `revoke` (401), `withhold` (403 sur les ventes, les statistiques ou les webhooks), `breakShape` (réponse sans `pageInfo`), `positionOf`, `calls`, `webhooks` (ceux inscrits, avec leur secret inventé), `delivery` (la livraison qu'enverrait Reveal pour une ligne du registre, signée avec le secret du webhook ; secret, `t` et id remplaçables pour en forger une), `revealSignature`.

## Fidélité

- Chaque endpoint de FakeReveal cite sa section de `reveal-api-observed.md` et la date de la capture qui le fonde.
- Les captures anonymisées retenues comme référence sont copiées dans `apps/api/src/__tests__/fake-reveal/recordings/` (sans secret ni donnée réelle, relues avant commit, gitleaks), et un test vérifie que les réponses de FakeReveal passent les mêmes schémas Zod que ces enregistrements.
- Quand une nouvelle capture montre un changement, FakeReveal et le journal des changements de `reveal-api-observed.md` sont mis à jour dans la même PR.

## Hors périmètre

Paiement réel, anti-bot réaliste au-delà du scénario `challenge`, interface web de Reveal.
