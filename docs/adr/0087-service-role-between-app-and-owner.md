# 0087. Un rôle de service entre le rôle applicatif et le rôle propriétaire de la base

Statut : accepted (« ok 0087 » de Charles le 12/11/2026 ; demande du 11/11/2026, fil « Corriger les failles de l'audit sécurité » : tout combler, même le mineur ; numéro attribué par le coordinateur)
Date : 2026-11-11
Précise : l'ADR 0005 (Postgres, Drizzle, RLS par `creator_id`) et l'ADR 0027 (déploiement). Ne remplace rien.

## Contexte

L'ADR 0005 a posé deux connexions : `DATABASE_URL`, le rôle applicatif, soumis aux politiques de lignes, et `DATABASE_ADMIN_URL`, le rôle qui possède les tables et joue les migrations. Le code traverse les créatrices par `withAdmin`, sur la seconde, « pour les tâches système seulement ».

Depuis, `withAdmin` a pris un second usage : les tables que le rôle applicatif n'a pas le droit de lire (liens à usage unique, clés chiffrées, sessions, journal d'audit) ne sont lues et écrites que par lui. Au 11/11, 186 appels vivent dans le code de l'API, dont une dizaine seulement dans des tâches de fond ; les autres servent une requête HTTP.

Le rôle derrière `withAdmin` est le propriétaire des tables. Il peut donc bien plus que ce que ces appels demandent : créer, modifier ou supprimer une table, retirer une politique de lignes, changer les droits d'un autre rôle. Un défaut dans n'importe lequel de ces 186 chemins aurait cette portée. Avec une seule créatrice, traverser les créatrices ne montre rien de plus ; avec une deuxième, si.

## Décision

1. **Trois rôles au lieu de deux.**
   - `impera_owner` (aujourd'hui `nirvana_admin`) : possède les tables. Il ne sert plus qu'aux migrations, à la sauvegarde et aux scripts `ops:*` lancés à la main. Ni l'API ni le worker ne se connectent avec lui.
   - `impera_service` (nouveau) : le rôle de `withAdmin`. Il se connecte, lit et écrit des lignes, traverse les créatrices, et rien d'autre : il ne possède aucune table, ne crée, ne modifie ni ne supprime aucun objet, ne donne aucun droit.
   - `nirvana_app` : inchangé, soumis aux politiques de lignes.

2. **Le rôle de service n'écrit que là où il en a besoin.** Ses droits sont donnés table par table, dans une migration, d'après ce que le code fait réellement : lecture partout où une tâche traverse les créatrices, écriture seulement sur les tables qu'un appel `withAdmin` écrit aujourd'hui. Une table nouvelle ne lui donne rien par défaut ; la migration qui la crée dit ce qu'elle lui ouvre.

3. **Le journal d'audit ne se réécrit pas.** Le rôle de service y ajoute des lignes et les lit ; il ne les modifie ni ne les supprime. Le jour où la politique de conservation demandera une purge, ce sera une tâche du propriétaire.

4. **L'API refuse de démarrer sur un mauvais rôle.** `assertDatabaseRoles` vérifie déjà que le rôle applicatif ne traverse pas les créatrices. Il vérifiera aussi que la connexion de `withAdmin` n'est ni propriétaire d'une table, ni superutilisateur, ni capable de créer un rôle ou une base.

5. **`withAdmin` cesse de grandir.** Un test compte les appels par module et échoue si un module en ajoute sans que la fiche de tâche le dise. Chaque lot qui touche un module regarde si un de ses appels peut passer par `withTenant` ou `withMember` avec une politique de lignes écrite pour lui, et le fait quand c'est le cas.

## Lots

- **a. Le rôle et ses droits** : migration qui crée les droits de `impera_service` (le rôle lui-même se crée à l'installation, comme `nirvana_app`), nouvelle variable `DATABASE_SERVICE_URL`, `withAdmin` branché dessus, garde au démarrage, `deploy.md`, `local-dev.md`, `init.sql`. `DATABASE_ADMIN_URL` reste lue par les migrations, la sauvegarde et les scripts `ops:*`.
- **b. Le test de plafond** des appels `withAdmin` par module.
- **c. La réduction**, module par module, au fil des lots de chaque fil propriétaire.

Sur le PC de Charles, le lot a demande une étape de plus au prochain « lance le CRM » : créer le rôle une fois (une commande, donnée par le fil qui tient le PC). Rien d'autre ne change à l'usage.

## Conséquences

- Positives : un défaut dans un chemin `withAdmin` ne peut plus toucher à la structure de la base, aux politiques de lignes ni au passé du journal d'audit ; ce que le code de service a le droit d'écrire devient lisible dans une migration ; le nombre d'appels cesse d'augmenter en silence.
- Négatives : une variable de configuration et un rôle de plus à créer à chaque installation ; une table nouvelle demande une ligne de droits en plus ; un droit oublié se voit comme une erreur « permission denied » dans une tâche, que les tests d'intégration doivent attraper (ils tourneront avec les trois rôles).
- À surveiller : le rôle de service traverse toujours les créatrices. Ce que cette ADR retire, c'est le pouvoir sur la structure ; la réduction du lot c est ce qui retire le reste, et elle doit être finie avant qu'une deuxième créatrice ait des fans réels.

## Alternatives rejetées

- **Ne rien changer tant qu'il n'y a qu'une créatrice.** Le risque sur la structure et sur le journal d'audit existe déjà avec une seule.
- **Supprimer `withAdmin` et tout écrire en politiques de lignes d'un coup.** 186 appels dans 16 modules : un chantier de plusieurs semaines qui toucherait la paie et les ventes au moment où elles se vérifient sur de vrais chiffres.
- **Un rôle par module.** Plus fin, mais seize connexions et seize jeux de droits à tenir pour une équipe de cette taille ; le lot c donne l'essentiel du gain sans cette charge.
