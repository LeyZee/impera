# 2026-11-14 — OPS-12 Le premier relevé répond aux messages frais — done
Fait : le premier relevé d'un compte applique la règle des 6 h comme les suivants (proposition d'Agent) : l'historique plus ancien est rattrapé, un message frais est répondu. `main` était rouge depuis #715 (test e2e de la phase 0, compte jamais relevé).
Pas fait : rien.
Décisions : la règle des 6 h vaut aussi pour le premier relevé (Agent, propriétaire de l'agent).
Découvertes : la CI de la PR #715 était verte alors que `main` ne l'est plus après sa fusion ; le coordinateur a la question du job e2e sur les PR.
Candidats à suppression : aucun.
Vérifié : `pnpm check` et `pnpm test` en local ; tests d'intégration et e2e sur la CI de la PR (pas de Docker ici).
