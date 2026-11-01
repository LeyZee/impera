# 2026-10-25 — security.md : les limites de débit comptent en mémoire — done
Fait : `docs/conventions/security.md` dit où vivent les compteurs des limites de débit : dans la mémoire du processus `api` (magasin par défaut de `@fastify/rate-limit`, `server.ts` et `auth.ts`). Ils repartent de zéro à chaque redémarrage et ne valent que pour une seule instance. Une deuxième instance demande d'abord un magasin partagé.
Pas fait : le magasin partagé lui-même, inutile tant qu'il n'y a qu'une instance (`operations.md`).
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓.
