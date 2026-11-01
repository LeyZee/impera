# 0027. Mise en production : deux images, un compose Coolify, un limiteur partagé en Postgres

Statut : accepted (Charles, 27/10 16h12)
Date : 2026-10-27

## Contexte

`docs/architecture/operations.md` prévoit Coolify sur le VPS (Hetzner), une image Docker par processus, des migrations jouées par un job dédié avant le démarrage, et Neon pour la base (ADR 0005). Rien de cela n'existait au 27/10 : aucun Dockerfile, aucun fichier de déploiement, aucun runbook de mise en service.

Le constat a montré un problème de plus : `pnpm build` produisait un `dist/` de l'API qui ne démarrait pas sous Node. Les paquets du dépôt (`@nirvana/contracts`, `db`, `llm`) exportent leurs sources TypeScript ; `dist/index.js` les importait tels quels (`ERR_MODULE_NOT_FOUND`). Une fois embarqués, le code lit encore deux dossiers à côté de lui : `../migrations` (`packages/db`) et `../prompts` (`packages/llm`). Personne ne l'avait vu, parce que rien ne lançait le build.

Enfin, le limiteur de débit (`@fastify/rate-limit`) compte en mémoire : chaque instance de l'API a ses propres compteurs, un redémarrage les remet à zéro, et deux instances doublent la limite.

## Décision

**1. Le build de l'API embarque le code du dépôt.** `apps/api/tsup.config.ts` regroupe `@nirvana/*` (et leurs dépendances) dans `dist/`, ainsi que better-auth, dont l'installation seule tirerait ses pairs optionnels (vitest, drizzle-kit) dans l'image. Les `dependencies` de l'API restent externes. Les paquets du dépôt et better-auth passent donc en `devDependencies` de `@nirvana/api` : ce sont des entrées du build, pas des dépendances d'exécution. Les scripts d'exploitation que le runbook appelle (`migrate`, `create-owner`, `ops-kill-switch`…) sont construits aussi, dans `dist/scripts/` : l'image n'a ni tsx ni les sources.

**2. Une image pour l'API et le worker** (`apps/api/Dockerfile`) : Node 22.22 (comme `.nvmrc`) sur Alpine, `ffmpeg` et `tini` depuis les paquets Alpine, utilisateur `node` (non root), dépendances de production seules, `HEALTHCHECK` sur `/health`. La même image tourne avec trois commandes : `node dist/index.js` (API), `node dist/worker.js` (worker), `node dist/scripts/migrate.js` (migrations). L'arborescence de l'image reproduit celle du dépôt (`/app/apps/api/{dist,migrations,prompts}`, `/app/personas/demo`), pour que les chemins relatifs du code restent vrais sans le toucher.

**3. Une image pour le dashboard** (`apps/web/Dockerfile`) : le build Vite servi par nginx (image non root). Le même nginx renvoie `/v1/` vers l'API : le dashboard et l'API partagent une origine, comme le proxy Vite en développement, et le cookie de session reste first-party. C'est la seule entrée publique ; l'API n'a pas de domaine. Derrière le proxy de Coolify et ce nginx, **`TRUST_PROXY_HOPS` vaut 2** (et non plus 1).

**4. Coolify déploie `docker-compose.prod.yml`** : `migrate` (une fois, puis sort), `api` et `worker` (démarrent seulement si `migrate` a réussi), `web` (attend une API saine). Toutes les variables viennent de Coolify ; le fichier n'en contient aucune valeur. La base est Neon, par son endpoint direct (Graphile Worker a besoin de `LISTEN/NOTIFY`, que le pooler ne garde pas).

**5. La CI construit et démarre les images** (job `images`) : la pile de production contre le Postgres de développement, avec des secrets jetables générés pour le run. Un chemin cassé (migrations, prompts, dépendance manquante) devient un rouge, pas une surprise le jour de la mise en service.

**6. Le limiteur de débit compte dans Postgres**, pas en mémoire : un `store` de `@fastify/rate-limit` sur une table de compteurs par fenêtre (mise à jour atomique `insert … on conflict`), partagée par toutes les instances de l'API. Pas de Redis : un service de plus à opérer et à sauvegarder pour quelques requêtes par seconde, alors que la base est déjà là. Livré dans sa propre PR, avec sa migration.

## Conséquences

- `pnpm build` produit enfin une API qui démarre ; le job `images` le garantit à chaque PR.
- Un fichier que le code lit relativement à lui-même doit être copié dans l'image : le Dockerfile le dit, la CI le vérifie.
- `TRUST_PROXY_HOPS=2` dans Coolify ; la valeur 1 notée jusqu'ici ferait voir à l'API l'adresse de nginx pour tous les clients, donc un seul compteur pour tout le monde.
- Le limiteur ajoute une requête courte par appel HTTP ; `/health` et `/ready` restent hors limite.
- Les procédures (première mise en service, variables, migrations, sauvegardes, retour arrière, coupe-circuit) vivent dans un runbook de déploiement, livré avec le lot 3 de la fiche.

## Alternatives rejetées

- **Lancer l'API avec tsx en production** : sources et outils de dev dans l'image, démarrage plus lent, et le build resterait faux.
- **Donner à l'API son propre domaine (routage par chemin dans Coolify)** : deux services publics, une configuration à la main dans Coolify, et un cookie à partager entre sous-domaines.
- **Postgres dans le compose au lieu de Neon** : contredit l'ADR 0005 (PITR, sauvegardes gérées).
- **Redis pour le limiteur** : voir § 6.
