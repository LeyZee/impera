# OPS-19 Mise en service sur le VPS Hostinger et la base Supabase
Statut : todo
Phase : exploitation
Dépend de : ADR 0152 (acceptée le 20/11/2026), ADR 0027, 0028, 0037, 0067, 0087 ; OPS-01, OPS-02
Branche : claude/project-thread-nnqahk

## Objectif
Impera tourne en https sur le VPS Hostinger de Charles, avec la base chez Supabase, sans qu'aucune règle de l'ADR 0152 ne soit tenue par la seule bonne volonté : chaque règle vérifiable est vérifiée par un test, par le démarrage ou par une étape du runbook.

## Contexte à lire
ADR 0152, `docs/runbooks/deploy.md`, `docs/architecture/operations.md`, `docker-compose.prod.yml`, `packages/db/src/client.ts`, `packages/db/docker/init.sql`, `apps/api/src/config.ts`, `ops/db-export`.

## À faire
### Lot a : le code (une PR, avant toute mise en service)
- [ ] Taille de chaque pool réglable par variable (API applicatif, API service, worker, Graphile), validée par Zod, documentée dans `.env.example` sans valeur ; le budget total affiché au démarrage dans les journaux.
- [ ] Test d'intégration : `anon`, `authenticated` et `service_role` (créés par le test comme sur Supabase, avec les privilèges par défaut de Supabase) n'ont aucun droit sur `public`, `graphile_worker` ni aucun schéma que nous créons, après les migrations et les `REVOKE` ; les privilèges par défaut sont révoqués pour `postgres` et `nirvana_admin`.
- [ ] Les `REVOKE` dans une migration (première libre au moment du tour), sans effet sur une base qui n'a pas ces rôles.
- [ ] Limite de CPU du service `worker` dans `docker-compose.prod.yml`.
- [ ] Version de Postgres : celle du projet Supabase de production ; si ce n'est pas 16, le dev, la CI, Testcontainers et l'image `backup` passent à la même version majeure.
### Lot b : le runbook
- [ ] `deploy.md` réécrit pour Hostinger (SSH par clé, compte nommé, pare-feu Hostinger, mises à jour automatiques), Coolify (tableau de bord par tunnel SSH, double authentification, aucun aperçu de PR, aucun webhook public : déploiement déclenché par Charles ou par interrogation du dépôt) et Supabase (organisation à part, plan payant, région UE, services hors Postgres coupés, restrictions réseau, pooler en mode session, création des trois rôles avec le rôle `postgres` puis plus jamais, vérification `pg_roles`).
- [ ] `operations.md` : Neon retiré, budget de connexions écrit.
- [ ] Surveillance extérieure de `/health` et `/ready`, du disque et des connexions SSH refusées : outil choisi et étapes écrites.
### Lot c : la mise en service, avec Charles au clavier
- [ ] Charles commande le VPS, choisit l'adresse définitive, crée le projet Supabase, saisit les secrets.
- [ ] Vérifications du runbook jouées sur le vrai serveur (rôles, budget de connexions, `TRUST_PROXY_HOPS`, journal du proxy sans chemins).
- [ ] Restauration de l'export chiffré jouée de bout en bout avant l'ouverture (ADR 0028).

## Critères d'acceptation
- Aucun domaine, adresse IP, nom d'hôte, identifiant de projet ni nom de compte dans le dépôt.
- La somme des pools reste sous le plafond du pool session mesuré sur le projet.
- Le test des droits échoue si un des rôles de Supabase peut lire une seule de nos tables.
- Rien n'est acheté, créé chez un fournisseur ni déployé sans le mot écrit de Charles.

## Hors périmètre
Le renouvellement de la session Reveal (non tranché, ADR 0152 § 8) ; l'option de restauration à l'instant de Supabase (décision d'argent de Charles) ; le registre RGPD des sous-traitants (fiche à part).
