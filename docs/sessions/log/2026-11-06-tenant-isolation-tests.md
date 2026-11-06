# 2026-11-06 — Tests d'isolation entre créatrices

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : coordinateur (A + B + C + D, une PR sans migration, données inventées, aucun code métier modifié)

## Fait

- **A, `packages/db/src/rls-policies.integration.test.ts`** : lit `pg_policies` et vérifie le catalogue.
  - Chaque politique permissive d'une table à `creator_id` lie `app.creator_id` en lecture et en écriture.
  - Les autres lient la personne ou la portée d'équipe.
  - Aucune n'est `true`.
  - Les tables en RLS sans politique sont listées et fermées à `nirvana_app`.
  - Les tables hors RLS qu'il atteint sont listées, avec leur raison.
  - Chaque exception est écrite avec sa raison, et la liste doit rester exacte.
- **B, `rls.integration.test.ts`** : pour les 18 tables de la liste, une créatrice ne modifie ni ne supprime aucune ligne d'une autre. Une empreinte md5 des lignes de B, lue en admin, reste identique.
- **C, `apps/api/src/__tests__/tenant-isolation.integration.test.ts`** : toutes les routes du serveur sont lues sur `printRoutes`.
  - Trois personnes de A (opérateur, compte créatrice, chatteur en portée self) appellent chaque route qui porte un id de B, et toutes les routes GET sans paramètre avec `?creatorId=B`.
  - Résultat attendu :
    - jamais de 2xx ;
    - aucune donnée de B dans une réponse ;
    - aucune ligne de B modifiée (toutes les tables à `creator_id`, plus son chatteur et son compte).
  - Un paramètre inconnu fait échouer le test. Les routes non couvertes sont listées une à une avec leur raison.
- **Relecture Équipe** :
  - `templateId` est semé chez B, car `shift_templates` porte `creator_id`.
  - Un manager actif de A (portée agency) est ajouté. Ce qu'il atteint de B est listé exactement dans `AGENCY_SCOPE` (ADR 0023 : l'équipe, ses rapports et sa paie, jamais le contenu de B). Les tables de B qu'il change sont listées dans `AGENCY_WRITES` : seulement `shift_templates`.
- **D** : les tests existants sont gardés.

## Reste

- `GET /v1/scheduling/shifts/:shiftId/feedback` répond 200 `{feedback: null}` sur le shift d'une autre créatrice, et 404 sur un id inconnu : c'est un oracle d'existence, sans donnée qui sorte. La route est en liste connue (`KNOWN_REACHED`), et sa correction revient à Équipe (`feedback-store.ts`, `inShiftCreator`). Le test casse quand elle est corrigée, et la ligne doit alors être retirée.
- Après relecture d'Équipe, cinq routes de planning et d'équipe reçoivent un corps valide : rapport, rejet, shift, note et retour. Le profil et les documents de prestataire s'arrêtent encore au schéma (400). Rejoués à la main par Équipe avec un corps valide, ils répondent 404.
- Routes non couvertes : la liste `RESIDUAL` (demandes d'échange et de congé, espace créatrice, factures, relevés, documents de prestataire). Chacune est couverte par les tests de son module.

## Découvertes

- Aucune.
