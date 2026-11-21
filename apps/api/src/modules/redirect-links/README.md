# Module `redirect-links` : les liens de redirection d'une créatrice (ADR 0080 § 4, ADR 0120 § 3, ADR 0121 § 1)

Les liens de redirection d'une créatrice (`redirect_links`) : un nom, une adresse `https://`, où il mène, son endroit (`placement`), sa phrase d'usage, allumé ou éteint. Avant INS-03 ils vivaient dans le réglage du canal Telegram ; ils ont désormais leur table, parce que la créatrice les lit (« Mes liens ») et que les relevés de clics s'y rattachent.

- **Peut dépendre de** : aucun module (feuille). `telegram` et le connecteur de liens le lisent par son `index.ts`, branchés par le composition root.
- **Tables possédées** : `redirect_links` (migration d'INS-03).
- **Jobs émis** : aucun.

## Qui lit, qui écrit

- **Le propriétaire seul** crée, corrige, place, allume et éteint les liens d'une créatrice, avec une connexion confirmée depuis moins de 10 minutes (ADR 0080 § 6 : une adresse décide où arrivent ses lecteurs).
- **Un manager actif** les lit, pour les créatrices de sa liste.
- **La créatrice** lit ses seuls liens allumés qui ont un endroit, sous forme de cartes (`creatorLinkCards`) : un nom, un endroit, une phrase d'usage, l'adresse à copier. Jamais un chiffre, jamais une écriture.
- Un chatteur ne lit rien.

## Routes

- `GET` et `POST /v1/creators/:creatorId/redirect-links`, `PUT /v1/creators/:creatorId/redirect-links/:linkId`. Lecture : propriétaire et manager actif (la créatrice sur sa liste), tous ses liens, éteints et sans endroit compris. Écriture : propriétaire seul, connexion récente (`reauthentication_forbidden` sinon). Aucune suppression : un lien s'éteint.
- `GET /v1/creator-space/links` : la créatrice, ses cartes (`CreatorLinksResponseSchema`, schéma strict), dans l'ordre des endroits, story du jour d'abord.

Refus : `redirect_link_name_conflict` et `redirect_link_url_conflict` (409, un nom ou une adresse déjà pris chez elle), `redirect_links_full_conflict` (409), `redirect_link_not_found` (404), `redirect_link_forbidden` (403). Une phrase d'usage qui contient une adresse est refusée par le contrat (400).

## Règles tenues par le code

- Écriture par `withAdmin` seul, après le contrôle du rôle, sous un verrou par créatrice ; `nirvana_app` ne fait que lire (politiques `creator_read` et `team_read`, `FORCE ROW LEVEL SECURITY`).
- La politique `creator_read` ne rend que les liens allumés qui ont un endroit : un oubli dans une requête ne montre pas un lien éteint.
- L'audit (`redirect_link.create`, `redirect_link.update`) note l'endroit, l'état et la présence d'une phrase, jamais une adresse.
- La phrase d'usage est du texte affiché, elle n'entre dans aucun prompt.
- `channelLinks(creatorId)` rend au module `telegram` les liens allumés d'une créatrice ; `null` tant qu'elle n'a aucune ligne, et le canal lit alors son ancien réglage.

## État (INS-03)

Table, recopie depuis le réglage du canal, routes et écrans faits. À venir (autres fiches de l'ADR 0121) : rattachement des liens de suivi, paliers, écran « Trafic ».
