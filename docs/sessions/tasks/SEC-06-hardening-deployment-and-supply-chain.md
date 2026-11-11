# SEC-06 Durcissement : écoute locale, proxy, chaîne d'approvisionnement
Statut : done
Phase : exploitation
Dépend de : SEC-01
Branche : claude/project-thread-bfbfaz (fil « Corriger les failles de l'audit sécurité »)

## Objectif (1 phrase)

Appliquer, sans changer le métier, les points d'hygiène de l'audit de sécurité du 11/11/2026 qui touchent l'installation locale, le proxy du dashboard, la CI, les images et les dépendances.

## Contexte à lire (fichiers précis)

- `docs/conventions/security.md` §1, §5 et §6, `docs/runbooks/local-dev.md`, `docs/runbooks/deploy.md`.
- Le rapport d'audit est gardé hors du dépôt (dépôt public), comme celui du 02/11.

## À faire (liste vérifiable)

- [x] La base de développement n'est publiée que sur cette machine.
- [x] L'API écoute sur cette machine par défaut ; l'image de production garde son écoute sur le réseau privé du déploiement.
- [x] Le proxy du dashboard borne le temps d'une requête lente et la taille des en-têtes.
- [x] Les actions de la CI et les images de base sont épinglées par empreinte, et Dependabot les suit.
- [x] Les dépendances indirectes dont un correctif a passé la quarantaine de 14 jours sont montées.

## Critères d'acceptation (tests, commandes, comportements observables)

- `server.test.ts` : `HOST` vaut `localhost` sans réglage ou laissé vide, et prend la valeur donnée.
- `pnpm check`, `pnpm test` et la CI verts, job `images` compris ; `pnpm audit --audit-level=high` vert.

## Hors périmètre

- Liens d'extension, limites de débit, bornes du message entrant : SEC-07.
- Rôle de base intermédiaire : ADR à proposer à Charles.
- Pare-feu, Cloudflare et le reste de l'hébergement : au déploiement (`docs/runbooks/deploy.md`).

## Notes de session (rempli par la session : décisions, surprises, fiches créées)

- L'API écoute sur `localhost` et non `127.0.0.1` : Fastify ouvre alors les deux familles d'adresses de la machine, et le proxy de Vite (`http://localhost:3000`) la trouve sous Windows comme ailleurs.
- Le proxy ne compte rien par adresse : derrière le proxy du déploiement il ne voit pas l'adresse du client sans réglage de plus. Les limites par adresse restent celles de l'API ; les délais ajoutés suffisent contre des connexions lentes.
- L'image Postgres de développement (`docker-compose.yml`) garde son étiquette : elle ne part jamais en production.
- Restent en avis modérés, en outils de développement seulement et sans correctif hors montée majeure : `esbuild` sous drizzle-kit, `glob` et `minimatch` sous testcontainers et eslint.

## Résultat

Base et API de développement sur la machine seule, délais du proxy, actions et images par empreinte suivies par Dependabot, `fast-uri` et `seroval` montés. `pnpm audit` : plus aucun avis sur ce qui tourne en production.
