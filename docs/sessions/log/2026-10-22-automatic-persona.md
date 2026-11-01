# 2026-10-22 · Automatique : la persona active fait partie de la version prouvée (recette R-G3, ADR 0022)

Fait :
- `drafts.persona_version_id` est enfin rempli : la persona active de la créatrice quand le brouillon est écrit, lue par la base dans l'insertion même.
- `blind_tests.persona_version_id` (migration 0013, colonne nullable, index de version élargi) : la persona active quand le propriétaire enregistre le test.
- Le verrou (`decided`, `latestBlindTest`) et la tendance du Dashboard (`dashboard-reader.ts`) ne lisent que la persona active ; `is not distinct from` couvre la créatrice sans persona.
- ADR 0022 (acceptée par Charles le 23/10) : la persona fait partie de la version qui ouvre l'Automatique ; glossaire et data-model.md à jour.
- Tests d'intégration : activer une persona referme l'Automatique au prochain `respond` et remet tout à prouver ; ses brouillons et son test le rouvrent, le test porte la persona ; un brouillon écrit garde la persona active.

Pas fait : les autres points de R-G3 sont déjà dans main (mode par créatrice #83 à #96, envoi en automatique après les gardes #92).

Décisions : la persona est lue par la base au moment de l'écriture, pas rapportée par le moteur (ADR 0022, alternatives).

Relectures : agent (`supervision/infra/views/dashboard-reader.ts`).

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test`, intégration `apps/api`.
