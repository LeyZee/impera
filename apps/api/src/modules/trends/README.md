# Module `trends` : veille et idées de contenu (ADR 0060)

Les signaux de tendance (`trend_signals`), les posts que l'extension relève quand une personne regarde Instagram (`trend_readings`), les idées de contenu du matin (`content_ideas`) et la liaison de l'extension d'une personne avec le serveur (`extension_links`). Migrations 0100 et 0104 (FORCE ROW LEVEL SECURITY, une liaison par navigateur).

**Lots a et b de VEI-01** (ce qui existe) : les tables et leur RLS (migration 0100, forcée par 0104), les contrats (`packages/contracts`, `trends.ts`, `content-drops.ts`, `public-outputs.ts`), les règles pures, et les trois portes du lot b ci-dessous. À venir : lots c (plafond de veille, captures pour la vision) et d (idée validée → suggestion de l'agenda → demande de contenu, après CR-05 et CR-06).

## Routes (`/v1`, lot b)

- `POST /trends/links` (propriétaire, membre de l'équipe qui n'est pas parti, créatrice) : « Coller un lien ». Corps `PasteTrendLinkBodySchema` : l'adresse d'un post ou d'un reel, lue par sa forme et ramenée à `https://www.instagram.com/<p|reel>/<code>/`, une ligne, un format, la créatrice visée. La créatrice ne colle que pour elle (403 `trend_link_forbidden` sinon) ; l'agence pour une créatrice qui existe. Réponse `{ created, url, expiresAt }` : un second collage de la même adresse pour la même créatrice n'ajoute rien (`created: false`). Le signal vit 14 jours.
- `GET /trends/extension-links`, `POST` (corps `{ label }`, 201, `no-store`), `DELETE /trends/extension-links/:id` (204, 404 sinon) pour les mêmes : « Relier l'extension », une liaison par navigateur (Chrome et Edge d'une même personne ne se révoquent plus). Un jeton de 256 bits, montré une seule fois, gardé en SHA-256 dans `extension_links` (par `withAdmin` : le rôle applicatif n'y a pas accès) ; relier de nouveau un navigateur du même libellé remplace sa liaison ; trois vivantes au plus (`EXTENSION_LINKS_LIVE_MAX`, tenu sous le verrou du compte), 409 `extension_links_full_conflict` au-delà ; la liste donne le libellé, la date et le dernier lot reçu (`lastUsedAt`), jamais le jeton ; chaque création et révocation va au journal d'audit. Un compte qui ne peut pas en avoir (parti, sans créatrice) reçoit 403 `extension_link_forbidden`.
- Les portes de l'extension, avec l'en-tête `x-extension-link` et sans session du CRM, hors contrôle d'origine, 30 appels par minute et par adresse : le jeton est lu en `preParsing`, après le plafond (un faux jeton compte) et avant le corps (401 `extension_link_unauthenticated` avant tout 400) ; la personne qu'il nomme est relue à chaque appel (un membre parti n'écrit plus rien) ; rien n'est journalisé sous `warn`.
  - `GET /trends/readings/creators` : les créatrices pour qui elle peut marquer un post, comme le relevé les vérifie (elle-même pour une créatrice, toutes pour l'agence).
  - `POST /trends/readings` : les relevés (VEI-02). Corps `TrendReadingsBatchSchema`, réponse `{ accepted }`. Une ligne par personne, session de veille et code de post : revu, un post prend ses derniers chiffres et textes, le plus long temps à l'écran, la première vue la plus ancienne et garde une marque donnée. Une marque pour une créatrice que la personne ne peut pas viser refuse le lot entier, rien n'est écrit (403 `trend_reading_forbidden`, `details.creatorIds` les marques refusées).
- La créatrice reçoit toujours `created: true` à un collage : « déjà là » lui dirait que l'agence l'a collé avant elle.
- Aucune de ces routes n'ouvre de connexion sortante : `__tests__/trends.integration.test.ts` échoue si `fetch`, `http`, `https`, `tls` ou une résolution DNS hors de la base sont appelés.

## Qui lit, qui écrit

- **Le propriétaire et un manager actif** (`withTenantMember`, scope `owner` ou `agency`) lisent les signaux de la créatrice et ceux de toute l'agence, tous les relevés, et décident des idées (valider, corriger, refuser).
- **Un chatteur** colle un lien pour la créatrice de sa transaction (`agency_link`, à son nom) et ne lit rien.
- **La créatrice** (`withCreatorAccount`) colle un lien à elle (`creator_link`), relève ce qu'elle regarde et ne marque un post que pour elle-même. Elle ne lit ni un signal ni une idée (ADR 0042 : elle ne voit jamais l'IA).
- **Les jobs** (Grok, ses statistiques, les comptes de référence, les relevés qui deviennent des signaux, les idées du matin) écrivent par `withAdmin`.
- Un signal n'est jamais changé ni retiré par l'application : il expire. Un lien collé deux fois pour la même créatrice n'ajoute rien (`trend_signals_link_unique`). Un post revu dans la même session de veille, par `/p/` ou `/reel/`, met à jour sa ligne (`trend_readings_session_post_unique`).
- `extension_links` est hors de portée de `nirvana_app`, comme `calendar_links` : lu par `withAdmin` seulement.
- Les trois tables sous RLS sont en `FORCE ROW LEVEL SECURITY` (migration 0104).

## Règles pures (`domain/`)

- **Péremption** (`signals.ts`) : 14 jours par défaut ; un signal est lu jusqu'à son échéance, exclue.
- **« Dépasse nettement la moyenne de son compte »** (`standsOut`) : au moins trois fois la moyenne des autres posts relevés du même compte, dont cinq au moins ont le chiffre ; les vues, sinon les j'aime.
- **Filtres des idées** (`ideas.ts`, ADR 0060 § 4), dans cet ordre : signal vivant cité ; persona active ; limites de la persona (`never_do`, `never_show`, `never_say`, `disgusts`), lues par `touchesTerm` de l'index de l'agent, jamais copié (`application/ideas.ts`) ; « jamais de nu » pour une sortie publique et garde Instagram (`public-outputs.ts` des contrats) ; jamais reproposée une idée proche d'une idée refusée par l'agence (`refused`) ou déclinée par elle dans son agenda (`declined`, posé par l'événement de l'agenda), quelle que soit sa date ; trop proche d'une idée des 30 derniers jours ou d'une idée gardée avant elle le même jour ; trois par jour au plus.
- **« Trop proche »** (`tooClose`) : même catégorie de dépôt et même signal d'origine, ou au moins 60 % de mots partagés entre le titre et « à tourner » (indice de Jaccard sur les mots de trois lettres ou plus, petits mots écartés, pluriel plié comme dans les gardes de l'agent).

Le serveur ne demande jamais rien à instagram.com : une adresse collée est lue par sa forme (`instagramPostOf`), jamais ouverte.
