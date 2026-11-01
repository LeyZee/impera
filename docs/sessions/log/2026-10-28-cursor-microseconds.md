# 2026-10-28 — Curseurs de la boîte à la microseconde — done
Fait : les curseurs de `GET /v1/conversations` et de `GET /v1/conversations/:id/messages` portent l’instant exact de Postgres, à la microseconde (`cursorInstant` dans `rows.ts`). Avant, ils le coupaient à la milliseconde d’un `Date`. La page suivante sautait alors les lignes de la même milliseconde qui venaient après la dernière lue. C’est la découverte notée avec #245. Les anciens curseurs, à la milliseconde, restent lisibles. Un test d’intégration parcourt trois messages et trois conversations de la même milliseconde, une page à la fois : il échoue sans le correctif et passe avec.
Pas fait : rien.
Découvertes : aucune.
Candidats à suppression : aucun.
