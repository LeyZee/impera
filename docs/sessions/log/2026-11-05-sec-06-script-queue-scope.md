# 2026-11-05 · SEC-06 : la file de scripts ne révèle plus l'existence d'une créatrice

- Fiche : recette du 05/11, SEC-06 (Charles, « go recos » et « attaque tous les constats »).
- Fait : `GET /v1/creators/:creatorId/script-queue` ne répond qu'au propriétaire et à un manager actif (portée `owner` ou `agency` de `withTenantMember`). Tout autre compte reçoit le même 404 `script_queue_creator_not_found` pour une créatrice qui existe et pour une qui n'existe pas. Avant, `creators` étant hors RLS, le contrôle « elle existe » était toujours vrai et répondait 200 avec une file vide. La table de la file reste protégée par sa RLS comme avant.
- Tests : `script-queue-scope.integration.test.ts` (propriétaire et manager de ses créatrices lisent ; chatteur : même 403 `creator_forbidden` de la garde de la reco 8, #541, pour une autre créatrice et un id inconnu, 404 pour la sienne). Il échoue sans le correctif. `script-structures.integration.test.ts` n'est pas touché.
- Découvertes : aucune.
