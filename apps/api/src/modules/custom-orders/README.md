# Module `custom-orders` : les commandes sur mesure (ADR 0159)

Ce que le fan commande en dehors des scripts : une vidéo, une photo, une réaction, un appel, une visio. Premier lot : la **grille des prix sur mesure** de chaque créatrice. Deuxième : **comprendre la demande avant son oui** (`customOrderTurn`). Le prix annoncé, l'acompte et la livraison viennent dans les lots suivants de l'ADR 0159.

- **Peut dépendre de** : aucun module (feuille).
- **Tables possédées** : `custom_price_grids` (migration 0236).
- **Jobs émis** : aucun.

## La grille

Un prix par format (fixe, ou à la minute avec un minimum pour un appel ou une visio ; une vidéo a des minutes comprises et un pourcentage par minute en plus), puis des suppléments en pourcentage du prix du format, qui s'ajoutent quel que soit le format. Chaque ligne porte « Elle le fait ? » : sur non, la demande est déclinée sans lui demander. Le calcul est `quoteCustomOrder` du contrat (`@impera/contracts`), le même pour l'écran et pour le serveur : jamais un modèle de langage ne calcule un prix.

## Qui lit, qui écrit

- **Le propriétaire seul**, lecture et écriture. Un manager, un chatteur et la créatrice ne lisent rien (politique `owner_read`, restrictive `creator_closed`, `FORCE ROW LEVEL SECURITY`).
- Chaque enregistrement ajoute une version, jamais une ligne changée : la date de chaque version est gardée.

## Comprendre la demande, avant son oui (`domain/turn.ts`)

Code pur, exporté par `index.ts` et branché par le module `agent` dans son tour. Le cerveau lit le format, les suppléments (ids de la grille donnés au tour) et les détails (`CustomOrderReading` des contrats) ; ce module décide :

- ce qui prime d'abord (`stop`) : pas de vente possible ou ce qu'elle ne fait jamais, elle décline ; limites inconnues ou âge non confirmé, elle « va y réfléchir » et rien ne s'ouvre ;
- « Elle le fait » sur non dans la grille : décliné sans lui demander ;
- sinon une question légère à la fois sur la case suivante (`ESSENTIAL_DETAILS`, au plus trois par format), au plus `CUSTOM_ORDER_QUESTIONS_MAX` questions ;
- fiche complète : elle part à la créatrice avec le prix de sa grille ; incomplète après les questions : au propriétaire ; puis elle garde le fan au chaud.

Chaque réponse passe sous les gardes `no_commitment` (ni oui, ni prix, ni délai) et `no_tip_request`. Un brief nomme la case à demander, jamais ce que le fan a écrit : ses mots n'entrent dans un prompt que dans un bloc non fiable.

## Routes

- `GET /v1/creators/:creatorId/custom-prices` : la grille en vigueur, la grille vide (version 0) avant le premier enregistrement.
- `PUT /v1/creators/:creatorId/custom-prices` : la grille entière, sur la version lue (`baseVersion`). Une autre version enregistrée depuis : `custom_prices_version_conflict` (409), rien n'est écrit. Le même enregistrement rejoué rend la même version.
- Refus : `custom_prices_creator_not_found` (404), aussi pour un compte qui n'est pas le propriétaire de l'agence.

## Règles tenues par le code

- Écriture dans la même transaction `withTenantMember` que le contrôle du propriétaire lu en base (politique `owner_insert`), sous un verrou par créatrice ; le rôle de service ne fait que lire.
- Le tour de l’agent lit la grille en vigueur par `gridOf` (rôle de service, lecture seule, une créatrice à la fois) : seul le prix calculé en sort, jamais la grille dans un prompt.
- Les commandes du fan : `orders.openFor` et `orders.record`, appelés par le tour de l’agent dans sa propre transaction (`withTenant`). Une commande ouverte par fan au plus ; un message déjà enregistré ne change rien ; un refus ferme la commande (`cancelled`). Table `custom_orders` (migration 0242), fermée au compte de la créatrice.
- L'audit (`custom_price_grid.save`) note la version, le nombre de formats proposés et de suppléments, jamais un prix : les prix sont une méthode de l'agence.
- Aucun prix réel dans le dépôt, les tests ni les fixtures (ADR 0010) : le propriétaire saisit tout dans le CRM.
