# Module `connectors`

**Rôle.** Port `PlatformConnector` et ses adaptateurs (`RevealApiConnector`, `FakeConnector`, plus tard `NirvanaPlatformConnector`). Seul module autorisé à parler à une plateforme externe.

**Peut dépendre de.** conversations (`ingestMessage` pour les messages entrants). Implémente aussi le port `OutboundSender` défini dans `conversations/domain/ports.ts` ; le composition root fait le branchement, `conversations` n'importe jamais ce module.

**Règles propres.** Aucun autre module n'importe un adaptateur directement : tout passe par le port.

## Ce qui existe (P0-06)

- `domain/platform-connector.ts` : le port et `ConnectorError` ; `domain/rhythm.ts` : rythme des relèves et coupe-circuit.
- `application/` : jobs `dispatch`, `poll`, `reconcile` ; `sessions` ; `outbound-sender` (port `OutboundSender` de `conversations`).
- `infra/fake/FakeConnector.ts` : plateforme en mémoire à scénarios. `infra/__tests__/contract.test.ts` : la suite que tout adaptateur doit passer.
- `infra/http/routes.ts` : `POST /v1/connector/sessions`, la « Sync » de l'extension, authentifiée par le jeton d'appareil (`x-extension-token`) vérifié dès l'arrivée de la requête : sans jeton valide, 401 `device_unauthenticated` avant toute lecture du corps (jamais un 400 qui listerait les champs attendus).
- Un adaptateur se branche par le registre (`ConnectorRegistry`, une fabrique par plateforme) passé à `createApp` ; registre vide = aucun compte relevé.

## Flux de ventes (CRM-01, ADR 0050)

Deuxième port, distinct du connecteur : `PlatformSalesFeed` (`domain/sales-feed.ts`) lit les ventes, les remboursements, les modèles, l'équipe et les chiffres d'une plateforme avec une clé d'agence, sans session.

- `infra/reveal-crm/` : l'adaptateur de l'API CRM Reveal (`api.reveal.me`, en-tête `x-api-key`), schémas dans `wire.ts`. 401 et 403 rendent la clé « à reconnecter », 429 suit `Retry-After`, une forme inattendue ou un net différent de agence + créatrice refuse toute la page. Le pseudo du fan ne passe jamais l'adaptateur.
- `application/sales-feed.ts` : Réglages (connecter, retirer, relier un modèle ou un chatteur, inscrire le webhook) et le job `connector.read_sales` (une fois par minute, `crontab.ts`), qui lit au plus 20 pages par passage. Avec un webhook qui marche, la minute devient un rattrapage horaire : c'est la livraison qui réveille la lecture.
- `infra/db/sales-feed-keys.ts` : la clé, scellée avec `CREDENTIALS_ENCRYPTION_KEYS` (contexte `sales_feed:<plateforme>`) dans `sales_feed_credentials`, retirée au rôle applicatif ; rechiffrée par `pnpm ops:reencrypt-credentials`, vérifiée par `pnpm ops:check-keys`. Table propre et non `provider_credentials`, dont l'enum ne connaît que les services d'IA.
- `infra/db/sales-ledger.ts` : les lignes et le curseur dans une seule transaction (curseur verrouillé, page périmée ignorée) ; ligne unique sur (plateforme, vente, événement) ; modèle inconnu en quarantaine ; signaux par `domain_events`.
- `infra/http/sales-feed-routes.ts` : `/v1/settings/sales-feeds…`, propriétaire seul ; connecter ou retirer la clé redemande une connexion récente. Aucune réponse ne contient la clé. Les refus portent un code de `SALES_FEED_ERROR_CODES` et leur phrase.
- Webhook (ADR 0050 § 3) : `PUT /v1/settings/sales-feeds/:plateforme/webhook` l'inscrit chez la plateforme à l'adresse `AUTH_BASE_URL` + `/v1/webhooks/sales-feeds/:plateforme` (HTTPS seulement, sinon 422 ; clé connectée exigée, sinon 409) et remplace l'ancien ; `DELETE` le retire ici et chez elle, comme le retrait de la clé. Le secret, donné une fois, est scellé comme la clé (`infra/db/sales-feed-webhooks.ts`, contexte `sales_feed_webhook:<plateforme>`). La route publique (`infra/http/sales-feed-delivery-routes.ts`, sans contrôle d'Origin) garde le corps brut : signature `X-Reveal-Signature` vérifiée sur ces octets en temps constant, `t` refusé à plus de 5 minutes (`infra/reveal-crm/delivery.ts`), sinon 401 sans rien garder. Une livraison acceptée n'entre dans la boîte de réception `sales_feed_deliveries` que par son id, son événement et sa position (une seconde fois : ignorée), puis met en file `connector.read_sales` avec `woken` : la ligne elle-même est relue par curseur, dans l'ordre du registre, donc jamais écrite par deux chemins. La boîte garde sept jours. Une livraison refusée laisse seulement son heure (`lastRejectedAt` dans l'état) : c'est le seul cas où le propriétaire doit agir, en réinscrivant le webhook. Le silence, en revanche, est normal : aucune livraison pendant des heures veut dire aucune vente, la lecture par curseur reste le filet, et on n'ajoute pas d'alerte « webhook muet ». `PUT …/webhook` ne prend pas de corps : l'envoyer sans `content-type` (un `application/json` vide est refusé en 400 par Fastify).
- Quarantaine : relier un modèle fait entrer au registre, dans la même transaction, toutes ses ventes en attente ; l'écran peut donc dire « N ventes en attente seront comptées ». Le `quarantined` de la ligne d'état est la somme de celui des modèles. L'aperçu donne aussi les comptes qu'on peut choisir (`accounts`, avec le modèle déjà lié à chacun) et qui a posé chaque lien (`linkedBy` : `auto` par le pseudo à la connexion, ou le membre). Le propriétaire confirme un lien `auto` en le reposant vers le même compte : il devient le sien, daté et inscrit au journal, sans rien déplacer.

Tables possédées : `sales_feed_credentials`, `sales_feed_cursors`, `sales_feed_models`, `sales_feed_chatters`, `platform_sales`, `platform_sales_quarantine` (migration 0065), `sales_feed_webhooks`, `sales_feed_deliveries` (migration 0067). Tests contre le faux CRM de `__tests__/fake-reveal/crm.ts`.

## Vérification de fiabilité (CRM-02, ADR 0050 § 8)

- `POST /v1/settings/sales-feeds/:plateforme/check`, propriétaire seul, trois par minute et par adresse (les statistiques de Reveal sont limitées à dix appels par minute et 500 par jour pour l'agence). Corps : `from`, `to` (31 jours au plus, dans le jour de la plateforme) et `export`, le texte CSV de l'export du dashboard ou `null`. L'export est lu pour la réponse et gardé nulle part, et aucun montant de paie ne bouge. Le rapport, lui, est gardé dans `sales_feed_checks` (une ligne par vérification, jamais réécrite, avec qui l'a lancée et s'il est propre). `GET` sur la même route rend le dernier, ou `null`. Propre (`isCleanMatch`) veut dire `match` sur une quinzaine entière (du 1er au 15, ou du 16 à la fin du mois), sans note `bot_not_linked_to_agent` ni `export_unknown_model` : c'est le rapport sur lequel la bascule de CRM-03 reposera. Un rapport gardé doit toujours se lire avec `SalesFeedCheckReportSchema` : on y ajoute des champs, on n'en retire jamais.
- `domain/reliability-check.ts` compare, au centime et par modèle et par jour, le registre (lignes enregistrées et en quarantaine, `infra/db/sales-ledger.ts` `checkLines`) avec `/v1/stats/daily` et l'export, puis, par membre de l'équipe de la plateforme, le registre avec `/v1/stats/chatters/daily`. Une vente compte le jour de sa date dans le fuseau de la plateforme (`timeZone` de l'adaptateur, `Europe/Paris` pour Reveal), un remboursement est retranché du jour de sa vente comme le font les statistiques. Un remboursement dont la vente est plus ancienne que le registre ne se place nulle part et se compte dans une note.
- Verdict : `match` quand les trois sources disent les chiffres du registre et que rien n'est resté sans comparaison ; `mismatch` dès qu'un net diffère (le nombre de ventes d'un membre est affiché, pas comparé : Reveal ne dit pas si son `salesCount` retire un remboursement) ; `incomplete` quand le reste concorde mais qu'une source manque (pas d'export, statistiques refusées), qu'une modèle de l'export est inconnue ou que le registre commence après le premier jour. Notes : remboursement sans vente, bot de la plateforme non relié à l'agent, modèle de l'export inconnue, lignes hors des jours, statistiques indisponibles, registre qui commence après le premier jour. Les jours doivent être terminés dans le fuseau de la plateforme (sinon 422 `sales_feed_check_days_unprocessable`). `registerReadAt` dit quand le registre a été lu ; l'export se télécharge juste avant la vérification. Une ligne de quarantaine libérée vers le registre n'est comptée qu'une fois.
- L'export : séparateur `;`, `,` ou tabulation, guillemets RFC 4180, montants en euros écrits comme un tableur (`12,34 €`, `1 234,56`), dates `AAAA-MM-JJ`, `JJ/MM/AAAA` ou instant ISO. Colonnes reconnues par leur nom (`EXPORT_HEADERS`) : date, modèle (identifiant ou pseudo de la modèle), montant TTC, revenu agence, revenu modèle, net ; il faut la date, le modèle et le net ou ses deux parts. Une colonne du fan n'est jamais lue. **Le vrai export n'a pas encore été vu** : ses noms de colonnes s'ajoutent à `EXPORT_HEADERS` à son arrivée. Un export illisible est refusé en 422 `sales_feed_export_unprocessable`, avec la colonne et la ligne, jamais une valeur ; un refus de la plateforme répond 502 avec son genre.

## Lecture des ventes par la paie (CRM-03, ADR 0050 §§ 5, 7 et 8)

`salesFeedReadsForPay`, exporté par `index.ts` (`infra/db/pay-reads.ts`), lit le registre dans la transaction de l'appelant, ligne par ligne, jamais une somme :
- `linesOfSalesBetween` : les ventes dont l'instant tombe dans la plage, et leurs remboursements quel que soit leur jour. Un remboursement compte au jour de sa vente ; celui d'une vente plus ancienne que le registre compte à son propre instant, avec `saleDay` à `null`.
- `linesRecordedBetween` : les lignes enregistrées dans la plage, quel que soit le jour de leur vente, c'est-à-dire les lignes tardives après une clôture (ADR 0032).
- `linesRelinkedBetween` : les lignes dont le lien du chatteur a pris sa version actuelle dans la plage. Relier un chatteur après une clôture est une attribution, qui compte dans la première quinzaine encore ouverte (§ 5).

Ces lectures se recouvrent exprès : un remboursement tardif sort dans la quinzaine de sa vente et dans celle où il a été enregistré. Un lecteur indexe donc les lignes par `platform`, `platformSaleId` et `event`, et compte chaque clé une seule fois.

Chaque ligne porte :
- l'id de la plateforme et l'événement, le compte, le type de vente ;
- l'instant de la ligne et celui de sa vente, avec son jour dans le fuseau que donne l'appelant (celui de l'agence) ;
- `recordedAt`, la devise, le net signé (négatif pour un remboursement) et le statut à la première lecture (`other` inconnu, `refund_asked` à signaler) ;
- son auteur selon le lien du propriétaire : membre, agent, chatteur non relié, ou personne. Pour un membre ou l'agent, la ligne porte aussi la version du lien (`sales_feed_chatters.link_version`) et l'instant où elle a été posée (`link_version_at`). L'auteur d'un remboursement est celui de sa vente.

La version du lien change dès qu'il pointe ailleurs, jamais quand le même lien est reposé : la paie la fige dans les entrées d'un relevé. La base d'une vente (`earningsBaseOf` des contrats : le net de la plateforme pour un compte Reveal en source « détectée », la chaîne de l'ADR 0023 partout ailleurs) suit les règles de paie datées du compte. Rien ici ne somme, n'attribue à un shift ni n'applique de taux : c'est le travail de la paie.

## Structure

- `domain/` : types, règles pures, machines d'état. Zéro I/O, zéro import de framework.
- `application/` : cas d'usage (commandes, requêtes, handlers de jobs). Orchestrent le domaine et les ports.
- `infra/` : implémentations (Drizzle, HTTP Fastify, jobs Graphile, clients externes).
- `index.ts` : **seule** porte d'entrée publique du module. Tout ce qui n'y est pas exporté est privé.

Voir `docs/architecture/modules.md` pour les règles communes et `docs/playbooks/add-a-module.md` pour en créer un.
