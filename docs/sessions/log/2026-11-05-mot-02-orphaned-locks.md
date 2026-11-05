# 2026-11-05 — Recette MOT-02, MOT-11, MOT-12, MOT-14 : les verrous d'un worker tué sont rendus en une minute

Fait :
- le battement d'un worker est écrit sous l'identifiant de son pool Graphile (celui de `locked_by`), lu sur l'événement `pool:create` ; sans lui, le worker refuse de démarrer ;
- `releaseOrphanedLocks` (`apps/api/src/orphaned-locks.ts`) : au démarrage puis toutes les minutes, chaque worker libère par `force_unlock_workers` les jobs et files verrouillés depuis plus de 5 minutes par un pool sans battement depuis 5 minutes ;
- `/ready` ajoute `orphanedJobs`, sans passer « non prêt » ;
- `operations.md` § Verrous d'un worker mort ;
- MOT-12 : contre un Postgres existant, `IMPERA_TEST_ROLE_PASSWORD` donne le mot de passe des rôles de test (défaut `test`) ; un mauvais arrête l'exécution avant toute base, avec un message français (testing.md) ;
- MOT-14 : `PASSWORD_BREACH_CHECK=off` saute la vérification des mots de passe fuités sur une machine hors ligne (développement, recette), dit en ambre au démarrage ; la production refuse de démarrer avec ;
- MOT-11 : le test des 100 essais d'un compte (`auth-limits`) a 90 s, ses 100 mots de passe hachés dépassant 30 s sous charge.

Décisions :
- pas de migration : la table `worker_heartbeats` garde sa forme, seule la clé change de sens ;
- 5 minutes laissent passer un worker qui démarre (battement à venir) ; un job long d'un worker vivant n'est jamais rendu.

Découvertes :
- pendant un déploiement progressif, un worker de l'ancienne version bat sous un identifiant à lui : ses jobs de plus de 5 minutes peuvent être rendus et rejoués (idempotents).

Vérifié :
- `pnpm check` ;
- intégration `orphaned-locks` (pool mort, jamais vu, vivant, qui démarre ; un worker qui démarre reprend le job d'un worker tué), `worker`, `shutdown`, `auth-limits`, toute la suite `packages/db` (et son arrêt sur un mauvais mot de passe des rôles) ;
- unitaire `server` (`/ready`, configuration).
