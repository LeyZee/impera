# 2026-11-05 · PRO-14 b : archiver une créatrice, sans rien supprimer

- Fiche : recette du 05/11, PRO-14 et reco 23 ; ADR 0071 § 2, acceptée par Charles (« ok 0071 », 05/11 20 h 22).
- Fait :
  - migration `creators_archive` : `creators.archived_at` ;
  - `POST /v1/creators/:creatorId/archive` et `…/restore`, `GET /v1/creators/archived` (propriétaire seul, connexion récente pour écrire) ;
  - l'archivage est refusé en 409 `creator_planned_conflict` tant qu'un shift n'est pas fini ou qu'un shift régulier tourne, avec les deux comptes (`scheduling.planned`) ;
  - une fois archivée :
    - ses liens sont révoqués et `auth` refuse ses sessions et sa connexion ;
    - aucun nouveau lien n'est créé pour elle ;
    - l'interrupteur de son agent est mis (« Créatrice archivée ») et la garde de code `creator_archived` bloque réponse, envoi, relance et approbation (409 `creator_archived_conflict`) ;
  - `GET /v1/creators`, « À traiter », les Alertes et Telegram ne la listent plus. `list` la garde pour son historique : paie, rapports, shifts passés.
- Tests : `creator-archive.integration.test.ts` ; approbation refusée dans `conversations.integration.test.ts` ; message du lecteur dans `reader-model.test.ts`.
- Découvertes :
  - le planning peut encore créer un shift sur une créatrice archivée à la main : à fermer côté Équipe ;
  - un groupe d'alertes « toutes les créatrices » ne s'étend pas d'office à une créatrice rouverte.

**Après relecture Équipe** : un modèle de shift arrêté aujourd'hui, ou avant son premier jour, ne retient plus l'archivage (`valid_until > today and valid_until >= valid_from`) ; le test arrête les modèles par `DELETE /v1/scheduling/shift-templates/:id`. Espacement repris sur Accès et Profil (consigne design du 05/11), captures refaites.
