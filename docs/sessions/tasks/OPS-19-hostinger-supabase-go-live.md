# OPS-19 Mise en service sur le VPS Hostinger et la base Supabase
Statut : in_progress (lot a en revue)
Phase : exploitation
Dépend de : ADR 0152 (acceptée le 20/11/2026), ADR 0027, 0028, 0037, 0067, 0087 ; OPS-01, OPS-02
Branche : claude/project-thread-nnqahk

## Objectif
Impera tourne en https sur le VPS Hostinger de Charles, avec la base chez Supabase, sans qu'aucune règle de l'ADR 0152 ne soit tenue par la seule bonne volonté : chaque règle vérifiable est vérifiée par un test, par le démarrage ou par une étape du runbook.

## Contexte à lire
ADR 0152, `docs/runbooks/deploy.md`, `docs/architecture/operations.md`, `docker-compose.prod.yml`, `packages/db/src/client.ts`, `packages/db/docker/init.sql`, `apps/api/src/config.ts`, `ops/db-export`.

## À faire
### Lot a : le code (une PR, avant toute mise en service)
- [x] Taille de chaque pool réglable par variable (`DATABASE_POOL_MAX`, `DATABASE_SERVICE_POOL_MAX` qui porte aussi Graphile Worker, `RATE_LIMIT_POOL_MAX`), validée par Zod, documentée dans `.env.example` ; le budget du processus écrit au démarrage dans les journaux.
- [x] Test d'intégration (`host-roles.integration.test.ts`) : `anon`, `authenticated` et `service_role` n'ont ni USAGE sur `public` et `graphile_worker`, ni EXECUTE sur nos fonctions, une fois `packages/db/supabase/lock-down.sql` joué (deux fois) ; nos rôles gardent ce qu'ils avaient.
- [x] Contrôle au démarrage (`assertNoForeignAccess`), en liste fermée : refus en production si un rôle autre que les nôtres, un superutilisateur ou le propriétaire de la base a USAGE sur nos schémas, ou si un objet de nos schémas a un autre propriétaire que le rôle qui a joué les migrations (extensions à part) ; simple avertissement ailleurs. `lock-down.sql` suit la même liste fermée.
- [x] Risque accepté, écrit au démarrage dans les journaux : les membres de `pg_read_all_data` que crée l'hébergeur (sur Supabase, `supabase_read_only_user`, `supabase_etl_admin` et `postgres`, vu sur le projet d'essai le 20/11) lisent toutes nos tables, quels que soient nos droits. Ce sont des rôles de l'hébergeur : aucun droit ne les ferme, le test d'intégration le vérifie avec un rôle membre de `pg_read_all_data`.
- [x] Refus au démarrage d'une connexion applicative ou de service dont le rôle est membre d'un rôle plus puissant (`postgres` sur Supabase, le propriétaire).
- [x] Migration 0234 : EXECUTE de nos fonctions retiré à PUBLIC, rendu à `nirvana_app` et `impera_service` seulement là où PUBLIC l’avait, sans droit par défaut pour les fonctions à venir ; un test fige les appelants de chaque fonction ; `migrate` retire aussi à PUBLIC le schéma de la file de jobs. Ce que seul `postgres` peut retirer (USAGE de `public` à PUBLIC, privilèges par défaut de `postgres`) est dans `lock-down.sql`, joué à la main.
- [x] Limite de CPU du service `worker` dans `docker-compose.prod.yml` (`WORKER_CPUS`, 1 par défaut).
- [ ] Version de Postgres : un projet Supabase neuf est en 17 (vu le 20/11). Le passage à 17 du dev, de la CI, de Testcontainers et de l'image `backup` a sa propre fiche, OPS-20.
### Lot b : le runbook
- [ ] `deploy.md` réécrit pour Hostinger (SSH par clé, compte nommé, pare-feu Hostinger, mises à jour automatiques), Coolify (tableau de bord par tunnel SSH, double authentification, aucun aperçu de PR, aucun webhook public : déploiement déclenché par Charles ou par interrogation du dépôt) et Supabase (organisation à part, plan payant, région UE, services hors Postgres coupés, restrictions réseau, pooler en mode session, création des trois rôles avec le rôle `postgres` puis plus jamais, vérification `pg_roles`).
- [ ] `operations.md` : Neon retiré, budget de connexions écrit.
- [ ] Étapes Supabase propres à notre base : `btree_gist` créée par `postgres` dans le schéma `extensions` avant le premier `migrate` (la migration 0021 ne fixe pas de schéma et passe alors sans rien faire), `lock-down.sql` joué après le premier `migrate` et après chaque mise à jour de Supabase, mot de passe de `postgres` hors de toute variable et changé après la mise en service.
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
