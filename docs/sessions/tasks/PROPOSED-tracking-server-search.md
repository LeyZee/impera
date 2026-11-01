# Suivi : recherche d'un fan côté serveur, au-delà des 200 conversations
Statut : proposed (ID à donner par Charles ; choix de Charles 28/10 : plus tard, quand le volume l'exige)
Phase : interface
Dépend de : `GET /v1/conversations` (P0-05), écran Suivi (`apps/web/src/screens/tracking`)
Branche : task/<id>-tracking-server-search

## Objectif
Dans Suivi, chercher un fan par son pseudo trouve sa conversation même quand elle n'est pas parmi les 200 plus récentes de la créatrice.

## Contexte
Suivi lit une seule page de `/v1/conversations` (200, le plus grand `limit` du contrat) et `searchLines` (`view.ts`) cherche dans ce qu'il a lu ; l'écran dit qu'il y en a d'autres (`hasMore`). Tant qu'une créatrice a moins de 200 conversations actives, cela suffit. Charles a choisi le 28/10 d'attendre que le volume l'exige.

## Contexte à lire
`docs/conventions/api.md` (§ Pagination), `packages/contracts/src/conversations.ts`, module `conversations` (lecture de la liste), `apps/web/src/screens/tracking/api.ts` et `view.ts`.

## À faire
- [ ] Contrat : un paramètre de recherche (`q`, pseudo, longueur bornée) sur `GET /v1/conversations`, Zod à la frontière ; même pagination par curseur.
- [ ] Serveur : comparaison sans casse ni accents, comme `folded` de l'écran (`unaccent` ou colonne normalisée), sous `withTenant` ; index si le plan le demande, par une nouvelle migration.
- [ ] Écran : au-delà des conversations lues, la recherche interroge le serveur (délai de frappe, annulation de la requête précédente) ; la phrase « seules les plus récentes » disparaît quand la recherche est complète.
- [ ] Tests : intégration (pseudo accentué, conversation hors des 200 premières, une autre créatrice jamais trouvée), écran (attente, aucun résultat, erreur).

## Critères d'acceptation
- Un fan hors des 200 dernières conversations se trouve par son pseudo, sans accent ni casse.
- Aucune conversation d'une autre créatrice n'apparaît (RLS).

## Hors périmètre
La recherche dans le texte des messages.

## Notes de session
