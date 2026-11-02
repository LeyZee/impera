# Module `notifications`

**Rôle.** Les notifications push de l'application installée (CR-01, ADR 0042 § 7), pour tous les rôles. Le module fait trois choses. Il garde la clé du serveur. Il enregistre les appareils de chaque compte et ses réglages. Il chiffre et livre un message à chacun d'eux. Ce qui doit sonner, et quand, se décide dans `domain/policy.ts` : heures calmes, plafond quotidien, ventes groupées en rafale. Un message ne porte jamais le nom d'un fan ni ce qu'il a écrit (ADR 0020).

**Peut dépendre de.** aucun module métier (feuille). Les modules qui notifient (EQ-12, CR-04, CR-13) reçoivent `deliver` par le composition root.

**Tables possédées** (migration `push_notifications`) :

- `push_server_keys`. La paire VAPID du serveur, créée au premier usage sous un verrou consultatif, sans aucune saisie (ADR 0016). La clé privée est scellée avec `CREDENTIALS_ENCRYPTION_KEYS` (contexte `push:vapid`). La table est hors RLS et retirée au rôle applicatif.
- `push_subscriptions`. Un appareil par ligne, sous RLS forcée (`own_rows`) : chacun ne lit que les siens. L'enregistrement passe par le rôle admin, avec le compte pris dans la session : un appareil qui a servi à un autre compte passe ainsi à celui-ci.
- `notification_preferences`. Heures calmes et plafond, sous RLS forcée. Sans ligne, les réglages par défaut s'appliquent (22 h – 8 h, 6 par jour).

**Routes** (montées sous `/v1`, contrat `packages/contracts/src/notifications.ts`, tous les rôles, chacun pour lui-même) :

- `GET /notifications/push-key` : la clé publique, lue par la page avant de demander l'autorisation.
- `PUT /notifications/subscriptions` (204) : enregistre l'appareil. L'adresse doit être celle d'un service push connu (`isPushServiceUrl`) : le serveur n'appelle jamais une adresse choisie par un client.
- `DELETE /notifications/subscriptions` (204) : oublie l'appareil, avant une déconnexion ou depuis Moi.
- `GET` et `PUT /notifications/preferences`.
- `POST /notifications/test` : sonne tout de suite sur chaque appareil du compte. Sans appareil, 404 `push_subscription_not_found`.

Sans `CREDENTIALS_ENCRYPTION_KEYS`, toutes les routes répondent 503 `service_unavailable`, et `deliver` est `null`.

## Structure

- `domain/` : `policy.ts` (règles pures, testées) et les ports.
- `application/devices.ts` : abonnement, réglages, livraison, test.
- `infra/web-push.ts` : RFC 8291 et RFC 8292 sur `node:crypto`, sans dépendance. Le test rejoue l'exemple de l'annexe A de la RFC 8291 octet pour octet.
- `infra/push-sender.ts` : l'envoi HTTP (10 s au plus, TTL 24 h). Un 404 ou un 410 retire l'appareil.
- `infra/db/`, `infra/http/`.
