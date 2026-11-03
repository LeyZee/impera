# Module `trends` : veille et idées de contenu (ADR 0060)

Les signaux de tendance (`trend_signals`), les posts que l'extension relève quand une personne regarde Instagram (`trend_readings`), les idées de contenu du matin (`content_ideas`) et la liaison de l'extension d'une personne avec le serveur (`extension_links`). Migration 0098.

**Lot a de VEI-01** (ce qui existe) : les tables et leur RLS, les contrats (`packages/contracts`, `trends.ts`, `content-drops.ts`, `public-outputs.ts`) et les règles pures. Pas encore d'`index.ts` : le module n'a ni route, ni job, ni stockage, qui arrivent avec les lots b (coller un lien, entrée des relevés, liaison de l'extension), c (plafond de veille, captures pour la vision) et d (idée validée → suggestion de l'agenda → demande de contenu, après CR-05 et CR-06).

## Qui lit, qui écrit

- **Le propriétaire et un manager actif** (`withTenantMember`, scope `owner` ou `agency`) lisent les signaux de la créatrice et ceux de toute l'agence, tous les relevés, et décident des idées (valider, corriger, refuser).
- **Un chatteur** colle un lien pour la créatrice de sa transaction (`agency_link`, à son nom) et ne lit rien.
- **La créatrice** (`withCreatorAccount`) colle un lien à elle (`creator_link`), relève ce qu'elle regarde et ne marque un post que pour elle-même. Elle ne lit ni un signal ni une idée (ADR 0042 : elle ne voit jamais l'IA).
- **Les jobs** (Grok, ses statistiques, les comptes de référence, les relevés qui deviennent des signaux, les idées du matin) écrivent par `withAdmin`.
- Un signal n'est jamais changé ni retiré par l'application : il expire. Un lien collé deux fois pour la même créatrice n'ajoute rien (`trend_signals_link_unique`). Un post revu dans la même session de veille, par `/p/` ou `/reel/`, met à jour sa ligne (`trend_readings_session_post_unique`).
- `extension_links` est hors de portée de `nirvana_app`, comme `calendar_links` : lu par `withAdmin` seulement.

## Règles pures (`domain/`)

- **Péremption** (`signals.ts`) : 14 jours par défaut ; un signal est lu jusqu'à son échéance, exclue.
- **« Dépasse nettement la moyenne de son compte »** (`standsOut`) : au moins trois fois la moyenne des autres posts relevés du même compte, dont cinq au moins ont le chiffre ; les vues, sinon les j'aime.
- **Filtres des idées** (`ideas.ts`, ADR 0060 § 4), dans cet ordre : signal vivant cité ; persona active ; limites de la persona (`never_do`, `never_show`, `never_say`, `disgusts`), lues par `touchesTerm` de l'index de l'agent, jamais copié (`application/ideas.ts`) ; « jamais de nu » pour une sortie publique et garde Instagram (`public-outputs.ts` des contrats) ; jamais reproposée une idée proche d'une idée refusée par l'agence (`refused`) ou déclinée par elle dans son agenda (`declined`, posé par l'événement de l'agenda), quelle que soit sa date ; trop proche d'une idée des 30 derniers jours ou d'une idée gardée avant elle le même jour ; trois par jour au plus.
- **« Trop proche »** (`tooClose`) : même catégorie de dépôt et même signal d'origine, ou au moins 60 % de mots partagés entre le titre et « à tourner » (indice de Jaccard sur les mots de trois lettres ou plus, petits mots écartés, pluriel plié comme dans les gardes de l'agent).

Le serveur ne demande jamais rien à instagram.com : une adresse collée est lue par sa forme (`instagramPostOf`), jamais ouverte.
