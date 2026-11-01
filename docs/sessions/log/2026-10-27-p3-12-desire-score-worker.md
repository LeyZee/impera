# 2026-10-27 — P3-12 note de désir : contrat, projection et worker

- **Fil** : Bilan (plomberie). Contrat accordé avec Agent, migration 0022 attribuée à P3-12 (ID validé par Charles à 20h37).
- **Fait** :
  - `packages/contracts/src/desire.ts` : `DesireBandSchema` (`neutral | playful | hot`), `desireBandOf`, bornes ;
  - événement `desire_scored` (`before`, `score`, `signals`, `weightsVersion`) ;
  - migration 0022 : `conversations.desire_score`, `desire_band` et `desire_at`, nullables ensemble ;
  - projection du dernier `desire_scored` ;
  - `ComposeInput.desire` (note et heure) et `desire` sur les résultats `draft` et `held` ;
  - `conversation.respond` écrit `desire_scored` dans la transaction du résultat, seulement quand la note change.
- **Tests** : `desire.test.ts`, `projection.test.ts`, `desire-score.integration.test.ts` (changement, note inchangée, reconstruction exacte, résultat abandonné, bornes).
- **Reste à Agent** : le calcul (`desire.ts`), `BriefSchema.desireSignals`, la politique, et l'export de `desireNow` pour le Suivi.
- **Découvertes** : aucune.
