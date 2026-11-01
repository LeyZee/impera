# 2026-10-27 — P3-09 Curseur de sexualisation et âge confirmé — done

Fait : `sexualizationDecision` décide, en code, si elle suit un fan qui sexualise (âge confirmé et minimum de KYC passé), si elle peut l'ouvrir elle-même (après `initiate_after_hours`), sinon elle recadre dans sa voix. `declaredAdultAge` confirme l'âge quand il écrit lui-même un âge de 18 à 99 ans, sans aucun âge mineur dans son message (décision de Charles, 18h38) ; le composeur pose `ageConfirmedAt` par `setFlagIfUnset`. Nouvelle garde bloquante `explicit_before_age` tant que l'âge n'est pas confirmé. Même règle dans le playground et les évals ; nouveau scénario `sexualization-too-early` (tier full).

Pas fait : rien de la fiche.

Décisions : sans limites de persona, elle ne va jamais sur ce terrain (fail closed). Un âge déclaré compte à partir du message suivant. Après relecture de Bilan : `ageDisputed` (contrat `fans`, ajout accordé par Bilan) empêche qu'un âge retiré se reconfirme par déclaration, et `noExplicit` est appliqué.

Découvertes : `onLimitsNotSaved` est à brancher sur le journal dans la composition root (Bilan). Le libellé de `explicit_before_age` manque dans `apps/web/src/screens/tracking/reader-model.ts`, comme celui de `discount` (zone Extension).

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test`, intégration agent et fans sur Postgres 16 local.
