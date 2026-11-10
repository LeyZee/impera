# En-têtes observés sur `api.reveal.me` (captures du 2026-11-10)

Source : captures anonymisées `reveal-2026-11-09-a`, `reveal-2026-11-10-a` et `reveal-2026-11-10-b` (exports HAR « sanitized » d'Edge). Ce fichier ne donne que des noms d'en-têtes et la forme de leurs valeurs, jamais une valeur de session.

## Requête

| En-tête | Forme de la valeur |
|---|---|
| `authorization` | `Bearer <jeton>`. La valeur est retirée par l'export « sanitized » : le type (JWT ou non) et la durée de vie (`exp`) **ne sont pas lisibles**. Sa présence se déduit des préflights (`access-control-request-headers: authorization` ou `authorization,content-type`). Aucun cookie n'est envoyé à l'API (pas de `access-control-allow-credentials`). |
| `accept` | `application/json, text/plain, */*` |
| `content-type` | `application/json` (POST, PATCH, PUT avec corps) |
| `origin` | `https://dashboard.reveal.me` |
| `referer` | `https://dashboard.reveal.me/` |
| `if-none-match` | `W/"<taille hex>-<hash>"` (ETag faible renvoyé par l'API ; la réponse est 304 s'il n'a pas changé) |
| `accept-language` | `fr,fr-FR;q=0.9,en;q=0.8,…` |
| `accept-encoding` | `gzip, deflate, br, zstd` |
| `user-agent`, `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform` | Ceux du navigateur. Attention : dans `reveal-2026-11-10-b`, le navigateur émulait un mobile (Android, `sec-ch-ua-mobile: ?1`), probablement le mode appareil de F12. Dans les autres captures, c'est un ordinateur. |
| `sec-fetch-dest`, `sec-fetch-mode`, `sec-fetch-site` | `empty`, `cors`, `same-site` |

Aucun en-tête maison (`x-…`) n'est envoyé à l'API, aucun jeton CSRF, aucun nonce ni aucune clé d'idempotence.

## Réponse (limites de débit)

Sur chaque réponse de l'API :

| En-tête | Valeur |
|---|---|
| `x-ratelimit-limit-short` | 50 |
| `x-ratelimit-reset-short` | 1 (secondes) |
| `x-ratelimit-limit-medium` | 100 |
| `x-ratelimit-reset-medium` | 1 à 10 (secondes restantes de la fenêtre de 10 s) |
| `x-ratelimit-limit-long` | 200 |
| `x-ratelimit-reset-long` | 1 à 60 (secondes restantes de la fenêtre de 60 s) |
| `x-ratelimit-remaining-short`, `-medium`, `-long` | compteur restant (minimum observé sur `-short` : 34) |

En plus, sur `POST /conversations/:id/messages` uniquement :

| En-tête | Valeur |
|---|---|
| `x-ratelimit-limit` | 60 |
| `x-ratelimit-remaining` | compteur restant |
| `x-ratelimit-reset` | instant de remise à zéro en secondes epoch (fenêtre d'une minute) |

`access-control-expose-headers: Retry-After,Server-Timing,X-Request-Id` : `Retry-After` est prévu, mais aucun 429 n'a été observé. Chaque réponse porte un `x-request-id`.

Autres en-têtes : `content-type: application/json; charset=utf-8`, sauf `GET /medias/get-upload-url` qui renvoie `text/html; charset=utf-8` (l'URL présignée en texte brut) ; `etag: W/"…"`.

## Valeurs `type` vues en clair

- `message.type` : `default` (seule valeur sur 380 éléments de message lus).
- `medias[].type`, `files[].type` : `photo`, `video`, `audio`.
- `bundle.type` : `media`.
- `transactions[].status` : `paid` ; filtre de requête `status[]` : `paid`, `refunded`, `refund_asked`.
- `fan-lists[].type` : `dynamic`, `static`.
- `pin.scope` : `personal`, `team`.
- `ppv-history?kind=` : `paid`, `free`.
- `conversations/model?filter=` : `all`, `pinned` ; `count?filter=` : `priority`, `pinned`, `online`.
- `notifications[].type` : **masqué** (texte de 9 caractères).
- `transactions[].type` : **masqué** (texte de 9 caractères).
- `subscriptionPeriodicity` (stats) : **masqué**.
