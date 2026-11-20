# Module `custom-orders` : les commandes sur mesure (ADR 0159)

Ce que le fan commande en dehors des scripts : une vidéo, une photo, une réaction, un appel, une visio. Premier lot : la **grille des prix sur mesure** de chaque créatrice. La prise de commande par l'IA viendra dans les lots suivants de l'ADR 0159.

- **Peut dépendre de** : aucun module (feuille).
- **Tables possédées** : `custom_price_grids` (migration 0236).
- **Jobs émis** : aucun.

## La grille

Un prix par format (fixe, ou à la minute avec un minimum pour un appel ou une visio ; une vidéo a des minutes comprises et un pourcentage par minute en plus), puis des suppléments en pourcentage du prix du format, qui s'ajoutent quel que soit le format. Chaque ligne porte « Elle le fait ? » : sur non, la demande est déclinée sans lui demander. Le calcul est `quoteCustomOrder` du contrat (`@impera/contracts`), le même pour l'écran et pour le serveur : jamais un modèle de langage ne calcule un prix.

## Qui lit, qui écrit

- **Le propriétaire seul**, lecture et écriture. Un manager, un chatteur et la créatrice ne lisent rien (politique `owner_read`, restrictive `creator_closed`, `FORCE ROW LEVEL SECURITY`).
- Chaque enregistrement ajoute une version, jamais une ligne changée : la date de chaque version est gardée.

## Routes

- `GET /v1/creators/:creatorId/custom-prices` : la grille en vigueur, la grille vide (version 0) avant le premier enregistrement.
- `PUT /v1/creators/:creatorId/custom-prices` : la grille entière, sur la version lue (`baseVersion`). Une autre version enregistrée depuis : `custom_prices_version_conflict` (409), rien n'est écrit. Le même enregistrement rejoué rend la même version.
- Refus : `custom_prices_creator_not_found` (404), aussi pour un compte qui n'est pas le propriétaire de l'agence.

## Règles tenues par le code

- Écriture dans la même transaction `withTenantMember` que le contrôle du propriétaire lu en base (politique `owner_insert`), sous un verrou par créatrice ; le rôle de service ne fait que lire.
- L'audit (`custom_price_grid.save`) note la version, le nombre de formats proposés et de suppléments, jamais un prix : les prix sont une méthode de l'agence.
- Aucun prix réel dans le dépôt, les tests ni les fixtures (ADR 0010) : le propriétaire saisit tout dans le CRM.
