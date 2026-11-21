# 2026-11-20 — CI : les tests en parallèle — done
Fait : le job « Tests » de `ci.yml` est découpé en six parties en parallèle (unitaires, e2e, intégration en quatre quarts par `vitest --shard`), et un job agrégé garde le nom « Tests (unit + integration) » exigé sur main. « Build » n'attend plus que « check ». Aucun test retiré.
Pas fait : rien.
Décisions : aucune ADR touchée (outillage de CI).
Découvertes : le dépôt appartient à un compte personnel, donc pas de file de fusion native de GitHub ; les trains de fusion se font à la main.
Candidats à suppression : aucun.
Vérifié : `turbo run test -- --shard=2/4 --passWithNoTests` transmet bien les options à Vitest (16 fichiers sur 65 pour `packages/contracts`), pnpm check, puis la CI de la PR.
